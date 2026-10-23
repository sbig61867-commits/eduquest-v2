import { NextResponse, type NextRequest } from 'next/server'
import { CTX_COOKIE, CTX_TTL_SECONDS, cookieOptions, refreshCtx, signCtx, verifyCtx, type SessionCtx } from './session'
import { AUTH_COOKIE_PREFIX } from './better'

// Step 9.6: the proxy's view of the session (replaces Supabase updateSession).
// A valid tm_ctx is read locally: no auth lookup, no database. When it is
// missing or expired but Better Auth's session cookie is there, the profile is
// refreshed once (one unit as app_auth + one as the user) and the new tm_ctx is
// written both to the response and to the request the page will render with.

// Better Auth names its cookie <prefix>.session_token, with __Secure- on HTTPS.
const SESSION_COOKIES = [`${AUTH_COOKIE_PREFIX}.session_token`, `__Secure-${AUTH_COOKIE_PREFIX}.session_token`]

export function hasAuthSession(request: NextRequest): boolean {
  return SESSION_COOKIES.some(name => !!request.cookies.get(name)?.value)
}

export async function readSession(request: NextRequest): Promise<{ response: NextResponse; ctx: SessionCtx | null }> {
  let ctx = await verifyCtx(request.cookies.get(CTX_COOKIE)?.value)
  if (ctx || !hasAuthSession(request)) {
    return { response: NextResponse.next({ request }), ctx }
  }

  ctx = await refreshCtx(request.headers).catch(() => null)
  if (!ctx) {
    // the session ended or the account is inactive: drop the stale context
    request.cookies.delete(CTX_COOKIE)
    const response = NextResponse.next({ request })
    response.cookies.delete(CTX_COOKIE)
    return { response, ctx: null }
  }
  const token = await signCtx(ctx)
  request.cookies.set(CTX_COOKIE, token)
  const response = NextResponse.next({ request })
  response.cookies.set(CTX_COOKIE, token, cookieOptions(CTX_TTL_SECONDS))
  return { response, ctx }
}
