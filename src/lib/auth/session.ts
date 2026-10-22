import { SignJWT, jwtVerify } from 'jose'
import { run, maybeOne } from '@/lib/db/sql'
import { neonSessionUser } from './neon'

// Step 9.6: the session on our own domain (docs/claude/STEP9_SQL_PLAN.md §11).
//   tm_session  Neon Auth's opaque session token (HttpOnly, 7 days)
//   tm_ctx      a token WE sign (HS256, APP_SESSION_SECRET) with the profile the
//               proxy and pages need for routing; 15 minutes
// A normal request verifies tm_ctx locally: no call to Neon Auth, no database.
// When it expires, refreshCtx() confirms the Neon session (one call) and reads
// the profile (one unit), then a new tm_ctx is issued. Isolation never depends
// on this cookie: the database denies a deactivated account on its next query.

export const SESSION_COOKIE = 'tm_session'
export const CTX_COOKIE = 'tm_ctx'
export const CTX_TTL_SECONDS = 15 * 60
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600

const ISSUER = 'tilmoo'
const AUDIENCE = 'tilmoo-app'

export type SessionCtx = {
  sub: string
  email: string | null
  role: string | null
  tenant_id: string | null
  is_active: boolean
  must_change_password: boolean
}

function key(): Uint8Array {
  const secret = process.env.APP_SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('auth: APP_SESSION_SECRET must be set (32+ characters)')
  return new TextEncoder().encode(secret)
}

export async function signCtx(ctx: SessionCtx): Promise<string> {
  const { sub, ...claims } = ctx
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CTX_TTL_SECONDS}s`)
    .sign(key())
}

/** The profile in a valid, unexpired tm_ctx; null otherwise. */
export async function verifyCtx(token: string | undefined | null): Promise<SessionCtx | null> {
  if (!token) return null
  try {
    const { payload: p } = await jwtVerify(token, key(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] })
    if (typeof p.sub !== 'string') return null
    return {
      sub: p.sub,
      email: typeof p.email === 'string' ? p.email : null,
      role: typeof p.role === 'string' ? p.role : null,
      tenant_id: typeof p.tenant_id === 'string' ? p.tenant_id : null,
      is_active: p.is_active === true,
      must_change_password: p.must_change_password === true,
    }
  } catch {
    return null
  }
}

/** The user's own profile row, read as that user (RLS: users_select allows the own row). */
export async function loadCtx(userId: string): Promise<SessionCtx | null> {
  const [rows] = await run({ as: 'user', userId }, sql => [
    sql`select id, email, role, tenant_id, is_active, must_change_password from public.users where id = ${userId}`,
  ])
  const u = maybeOne<{ id: string; email: string | null; role: string | null; tenant_id: string | null; is_active: boolean | null; must_change_password: boolean }>(rows)
  if (!u) return null
  return {
    sub: u.id,
    email: u.email,
    role: u.role,
    tenant_id: u.tenant_id,
    is_active: u.is_active !== false,
    must_change_password: u.must_change_password === true,
  }
}

/** A fresh profile for a live Neon session; null when the session was revoked or the account is inactive. */
export async function refreshCtx(session: string): Promise<SessionCtx | null> {
  const user = await neonSessionUser(session)
  if (!user) return null
  const ctx = await loadCtx(user.userId)
  return ctx && ctx.is_active ? ctx : null
}

/** Cookie attributes shared by both session cookies. */
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}
