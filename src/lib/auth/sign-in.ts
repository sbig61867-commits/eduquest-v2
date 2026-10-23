import { NextResponse } from 'next/server'
import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { authSignIn, authSignOut } from './better'
import { CTX_COOKIE, CTX_TTL_SECONDS, cookieOptions, loadCtx, signCtx } from './session'

// Step 9.6: the one place a session starts (email sign-in and member-ID
// sign-in both end here). On success the response carries Better Auth's
// session cookie and our signed tm_ctx, and tells the page where to go.

export async function startSession(
  email: string,
  password: string,
  request: Request,
  // member-ID sign-in says "wrong ID or password", email sign-in "wrong email or password"
  invalid: ApiErrorCode = 'invalidCredentials',
): Promise<NextResponse> {
  const result = await authSignIn(email, password, request.headers)
  if (!result.ok) {
    return result.reason === 'rate_limited'
      ? NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })
      : NextResponse.json({ ...(await apiErr(invalid)) }, { status: 401 })
  }

  const ctx = await loadCtx(result.userId)
  if (!ctx || !ctx.is_active) {
    // end the session that was just opened; it must not outlive this answer
    await authSignOut(new Headers({ cookie: result.setCookies.map(c => c.split(';')[0]).join('; ') }))
    return NextResponse.json({ ...(await apiErr('accountDisabled')) }, { status: 403 })
  }

  const response = NextResponse.json({ role: ctx.role, mustChangePassword: ctx.must_change_password })
  for (const c of result.setCookies) response.headers.append('Set-Cookie', c)
  response.cookies.set(CTX_COOKIE, await signCtx(ctx), cookieOptions(CTX_TTL_SECONDS))
  return response
}
