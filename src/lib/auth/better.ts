import { betterAuth } from 'better-auth'
import { Pool } from 'pg'
import { getLocale } from 'next-intl/server'
import { onWorkers } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'
import { sendPasswordResetEmail } from '@/lib/email'
import { toLocale } from '@/i18n/config'

// Step 9.6: sign-in runs inside our own Worker with Better Auth (owner's
// decision 2026-10-22: managed Neon Auth limits sign-in to ~8 per 10 s per IP).
// Its tables are in schema `ba`, reached only by the login role app_auth
// through its own Hyperdrive config (neon/migrations/0004_better_auth.sql);
// app_auth cannot read platform data and the platform roles cannot read
// password hashes. Ids are UUIDs, so public.users.id = ba."user".id and
// auth.uid() keeps working.
// The browser never calls Better Auth's HTTP routes: our own routes call the
// functions below, which keeps sign-up closed and the rate limits ours.

export const AUTH_COOKIE_PREFIX = 'tm'
const SESSION_DAYS = 7

async function connectionString(): Promise<string> {
  if (onWorkers) {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    const hd = (env as unknown as { HYPERDRIVE_AUTH?: { connectionString: string } }).HYPERDRIVE_AUTH
    if (hd?.connectionString) return hd.connectionString
  }
  const url = process.env.NEON_AUTH_DATABASE_URL
  if (!url) throw new Error('auth: NEON_AUTH_DATABASE_URL is not configured')
  return url
}

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET
  if (!s || s.length < 32) throw new Error('auth: BETTER_AUTH_SECRET must be set (32+ characters)')
  return s
}

function build(pool: Pool) {
  return betterAuth({
    database: pool,
    secret: secret(),
    baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    basePath: '/api/auth/ba',
    emailAndPassword: {
      enabled: true,
      // invitation-only platform: accounts are created by the server only
      disableSignUp: true,
      minPasswordLength: 8,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      // The link goes to our own /reset-password page (the browser never calls
      // Better Auth's routes); the page posts the token to /api/auth/reset-password.
      sendResetPassword: async ({ user, token }) => {
        const resetUrl = new URL(`/reset-password?token=${encodeURIComponent(token)}`, process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').toString()
        await sendPasswordResetEmail({ to: user.email, resetUrl, locale: toLocale(await getLocale().catch(() => 'ar')) })
      },
    },
    session: { expiresIn: SESSION_DAYS * 24 * 3600, updateAge: 24 * 3600 },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      database: { generateId: 'uuid' },
      // Cloudflare puts the real client address here; a class behind one
      // school NAT shares it, so the per-IP sign-in limit below is generous
      // and our routes add a strict per-account limit.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 300,
      customRules: {
        '/sign-in/email': { window: 60, max: 120 },
        '/request-password-reset': { window: 3600, max: 20 },
      },
    },
  })
}

type Auth = ReturnType<typeof build>

// Workers may not share a socket between requests: one auth instance with a
// one-connection pool per call (the pool lives in Hyperdrive). Node keeps one.
let nodeAuth: Auth | null = null
export async function withAuth<T>(work: (auth: Auth) => Promise<T>): Promise<T> {
  if (onWorkers) {
    const pool = new Pool({ connectionString: await connectionString(), max: 1, connectionTimeoutMillis: 10_000 })
    try { return await work(build(pool)) } finally { await pool.end().catch(() => {}) }
  }
  nodeAuth ??= build(new Pool({ connectionString: await connectionString(), max: 5, connectionTimeoutMillis: 10_000 }))
  return work(nodeAuth)
}

// ---------------------------------------------------------------- sessions

// Better Auth's own rate limiter runs only for requests through its HTTP
// router, not for these server calls (measured: the 121st sign-in in a minute
// was allowed), so the limits live here, on every sign-in path.
export const SIGN_IN_LIMITS = {
  // a class behind one school NAT shares the address
  perIp: { limit: 120, windowSecs: 60 },
  // password guessing against one account
  perAccount: { limit: 20, windowSecs: 900 },
}

export type SignInResult =
  | { ok: true; userId: string; setCookies: string[] }
  | { ok: false; reason: 'invalid' | 'rate_limited' }

/**
 * Signs in. On success returns the account id and the Set-Cookie headers that
 * carry Better Auth's session cookie, for the route to pass to the browser.
 */
export async function authSignIn(email: string, password: string, requestHeaders: Headers): Promise<SignInResult> {
  const account = email.trim().toLowerCase()
  const ip = requestHeaders.get('cf-connecting-ip') ?? 'unknown'
  const [byIp, byAccount] = await Promise.all([
    rateLimit(`signin:ip:${ip}`, SIGN_IN_LIMITS.perIp),
    rateLimit(`signin:acct:${account}`, SIGN_IN_LIMITS.perAccount),
  ])
  if (!byIp.allowed || !byAccount.allowed) return { ok: false, reason: 'rate_limited' }
  return withAuth(async auth => {
    const res = await auth.api.signInEmail({ body: { email: account, password }, headers: requestHeaders, asResponse: true })
    if (res.status !== 200) return { ok: false, reason: 'invalid' } as const
    const body = (await res.json()) as { user?: { id?: string } }
    if (!body.user?.id) return { ok: false, reason: 'invalid' } as const
    return { ok: true, userId: body.user.id, setCookies: res.headers.getSetCookie() } as const
  })
}

/** The account behind the session cookie in these headers; null when there is none or it ended. */
export async function authSessionUser(requestHeaders: Headers): Promise<{ userId: string; email: string } | null> {
  return withAuth(async auth => {
    const s = await auth.api.getSession({ headers: requestHeaders })
    return s?.user ? { userId: s.user.id, email: s.user.email } : null
  })
}

/** Ends the session; returns the Set-Cookie headers that clear the cookie. */
export async function authSignOut(requestHeaders: Headers): Promise<string[]> {
  return withAuth(async auth => {
    const res = await auth.api.signOut({ headers: requestHeaders, asResponse: true }).catch(() => null)
    return res ? res.headers.getSetCookie() : []
  })
}

/** Sends the reset email. Quiet about unknown emails (never says whether one exists). */
export async function authRequestPasswordReset(email: string, requestHeaders: Headers): Promise<void> {
  await withAuth(auth => auth.api.requestPasswordReset({ body: { email }, headers: requestHeaders }).catch(() => undefined))
}

export async function authResetPassword(token: string, newPassword: string): Promise<boolean> {
  return withAuth(async auth => {
    try { await auth.api.resetPassword({ body: { token, newPassword } }); return true } catch { return false }
  })
}

// ------------------------------------------------------ server-side admin

export type AuthAdminError = { message: string; duplicate: boolean; invalidEmail: boolean }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Creates an account with a password (staff-created accounts, invitations). */
export async function authCreateUser(input: { email: string; password: string; name: string }): Promise<{ id: string; error: null } | { id: null; error: AuthAdminError }> {
  const email = input.email.trim().toLowerCase()
  if (!EMAIL.test(email)) return { id: null, error: { message: 'invalid email', duplicate: false, invalidEmail: true } }
  return withAuth(async auth => {
    const ctx = await auth.$context
    if (await ctx.internalAdapter.findUserByEmail(email)) return { id: null, error: { message: 'an account with this email already exists', duplicate: true, invalidEmail: false } }
    const minLen = ctx.password.config.minPasswordLength
    if (input.password.length < minLen) return { id: null, error: { message: `password shorter than ${minLen}`, duplicate: false, invalidEmail: false } }
    const user = await ctx.internalAdapter.createUser({ email, name: input.name, emailVerified: true }, { method: 'admin' })
    try {
      await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: await ctx.password.hash(input.password) })
    } catch (e) {
      await ctx.internalAdapter.deleteUser(user.id).catch(() => {})
      throw e
    }
    return { id: user.id, error: null }
  })
}

/** Replaces the password and ends every session of the account. */
export async function authSetPassword(userId: string, newPassword: string): Promise<{ error: AuthAdminError | null }> {
  return withAuth(async auth => {
    const ctx = await auth.$context
    try {
      await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(newPassword))
      await ctx.internalAdapter.deleteUserSessions(userId)
      return { error: null }
    } catch (e) {
      return { error: { message: e instanceof Error ? e.message : String(e), duplicate: false, invalidEmail: false } }
    }
  })
}

/** Deletes the account (sessions, credentials and — by cascade — the profile row). */
export async function authRemoveUser(userId: string): Promise<{ error: AuthAdminError | null }> {
  return withAuth(async auth => {
    const ctx = await auth.$context
    try {
      await ctx.internalAdapter.deleteUserSessions(userId)
      await ctx.internalAdapter.deleteAccounts(userId)
      await ctx.internalAdapter.deleteUser(userId)
      return { error: null }
    } catch (e) {
      return { error: { message: e instanceof Error ? e.message : String(e), duplicate: false, invalidEmail: false } }
    }
  })
}

/** True when this email and password are correct; creates no session. */
export async function authVerifyPassword(email: string, password: string): Promise<string | null> {
  return withAuth(async auth => {
    const ctx = await auth.$context
    const found = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase(), { includeAccounts: true })
    const credential = found?.accounts?.find(a => a.providerId === 'credential' && a.password)
    if (!found || !credential?.password) return null
    return (await ctx.password.verify({ password, hash: credential.password })) ? found.user.id : null
  })
}
