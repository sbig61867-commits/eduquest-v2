import { createRemoteJWKSet, jwtVerify } from 'jose'

// Step 9.6: the only code that talks to Neon Auth (managed Better Auth).
// The browser never reaches Neon Auth: our routes call these functions and
// keep the session in cookies on our own domain (see ./session.ts).
// Facts measured on the trial (docs/claude/STEP9_SQL_PLAN.md §11): session
// cookie __Secure-neon-auth.session_token (7 days); /token returns an EdDSA
// JWT valid 15 minutes, verifiable with /.well-known/jwks.json; /sign-out
// revokes the session at once; admin endpoints work for a user whose Neon
// Auth role is 'admin' and refuse everyone else.

const SESSION_COOKIE = '__Secure-neon-auth.session_token'

function authUrl(): string {
  const url = process.env.NEON_AUTH_URL
  if (!url) throw new Error('auth: NEON_AUTH_URL is not configured')
  return url.replace(/\/$/, '')
}

// Neon Auth checks the Origin against its trusted origins.
const origin = () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

type CallResult = { status: number; data: unknown; session: string | null }

async function call(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; session?: string | null } = {}): Promise<CallResult> {
  const res = await fetch(authUrl() + path, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin(),
      ...(init.session ? { cookie: `${SESSION_COOKIE}=${init.session}` } : {}),
    },
    ...(init.method === 'GET' ? {} : { body: JSON.stringify(init.body ?? {}) }),
    signal: AbortSignal.timeout(10_000),
  })
  let session: string | null = null
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';')
    const eq = pair.indexOf('=')
    if (pair.slice(0, eq).trim() === SESSION_COOKIE) session = decodeURIComponent(pair.slice(eq + 1)) || null
  }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data, session }
}

const message = (data: unknown) =>
  (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') ? data.message : ''

// ---------------------------------------------------------------- sessions

/** Signs in with email and password. Returns the Neon session token, or null when refused. */
export async function neonSignIn(email: string, password: string): Promise<{ session: string; userId: string } | null> {
  const r = await call('/sign-in/email', { body: { email, password } })
  const user = (r.data as { user?: { id?: string } } | null)?.user
  if (r.status !== 200 || !r.session || !user?.id) return null
  return { session: r.session, userId: user.id }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

/** Verifies a Neon Auth JWT locally against the cached key set. */
export async function verifyNeonJwt(token: string): Promise<{ sub: string; email?: string } | null> {
  // issuer and audience are the Neon Auth host itself (measured on the trial)
  const host = new URL(authUrl()).origin
  jwks ??= createRemoteJWKSet(new URL(authUrl() + '/.well-known/jwks.json'))
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: host, audience: host })
    if (typeof payload.sub !== 'string') return null
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined }
  } catch {
    return null
  }
}

/** Confirms the session is still alive (one call): the user id, or null once it was revoked or expired. */
export async function neonSessionUser(session: string): Promise<{ userId: string; email?: string } | null> {
  const r = await call('/token', { method: 'GET', session })
  const token = (r.data as { token?: string } | null)?.token
  if (r.status !== 200 || !token) return null
  const v = await verifyNeonJwt(token)
  return v ? { userId: v.sub, email: v.email } : null
}

export async function neonSignOut(session: string): Promise<void> {
  await call('/sign-out', { session }).catch(() => {})
}

/** Sends the reset email; Neon Auth links back to `redirectTo` with a token. Always quiet about unknown emails. */
export async function neonRequestPasswordReset(email: string, redirectTo: string): Promise<void> {
  await call('/request-password-reset', { body: { email, redirectTo } }).catch(() => {})
}

export async function neonResetPassword(token: string, newPassword: string): Promise<boolean> {
  const r = await call('/reset-password', { body: { token, newPassword } })
  return r.status === 200
}

// ------------------------------------------------------- admin (service)

// A Neon Auth account whose role is 'admin' does server-side account work.
// Its credentials are secrets (NEON_AUTH_SERVICE_EMAIL / _PASSWORD); it has no
// public.users row, so it can read nothing in the database.
let adminSession: string | null = null

async function adminCall(path: string, body: unknown): Promise<CallResult> {
  const signIn = async () => {
    const email = process.env.NEON_AUTH_SERVICE_EMAIL, password = process.env.NEON_AUTH_SERVICE_PASSWORD
    if (!email || !password) throw new Error('auth: the Neon Auth service account is not configured')
    const s = await neonSignIn(email, password)
    if (!s) throw new Error('auth: the Neon Auth service account could not sign in')
    adminSession = s.session
  }
  if (!adminSession) await signIn()
  let r = await call(path, { body, session: adminSession })
  if (r.status === 401) { await signIn(); r = await call(path, { body, session: adminSession }) }
  return r
}

export type NeonAdminError = { message: string; duplicate: boolean; invalidEmail: boolean; status: number }

const adminError = (r: CallResult): NeonAdminError => {
  const m = message(r.data)
  return {
    message: m || `auth admin call failed (${r.status})`,
    duplicate: /already|exists/i.test(m) || r.status === 422,
    invalidEmail: /invalid email|email.*invalid/i.test(m),
    status: r.status,
  }
}

export async function neonCreateUser(input: { email: string; password: string; name: string }): Promise<{ id: string; error: null } | { id: null; error: NeonAdminError }> {
  const r = await adminCall('/admin/create-user', { email: input.email, password: input.password, name: input.name, role: 'user' })
  const id = (r.data as { user?: { id?: string } } | null)?.user?.id
  if (r.status !== 200 || !id) return { id: null, error: adminError(r) }
  return { id, error: null }
}

export async function neonSetPassword(userId: string, newPassword: string): Promise<{ error: NeonAdminError | null }> {
  const r = await adminCall('/admin/set-user-password', { userId, newPassword })
  return { error: r.status === 200 ? null : adminError(r) }
}

export async function neonRemoveUser(userId: string): Promise<{ error: NeonAdminError | null }> {
  const r = await adminCall('/admin/remove-user', { userId })
  return { error: r.status === 200 ? null : adminError(r) }
}
