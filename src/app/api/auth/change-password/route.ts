import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { currentCtx, serviceScopeFor } from '@/lib/auth/current'
import { authSetPassword, authVerifyPassword } from '@/lib/auth/better'
import { startSession } from '@/lib/auth/sign-in'
import { run } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'

// Replaces the signed-in user's password and clears the `must_change_password`
// flag that staff-created accounts start with. Setting a password ends every
// session of the account, so a fresh one is opened with the new password and
// its tm_ctx no longer carries the flag.
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx?.email) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const rl = await rateLimit(`change-password:${ctx.sub}`, { limit: 10, windowSecs: 3600 })
  if (!rl.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  const body = await request.json().catch(() => ({}))
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 8) return NextResponse.json({ ...(await apiErr('passwordTooShort')) }, { status: 400 })

  // The new password may not be the temporary one.
  if ((await authVerifyPassword(ctx.email, password)) === ctx.sub) {
    return NextResponse.json({ ...(await apiErr('passwordUnchanged')) }, { status: 400 })
  }

  const scope = serviceScopeFor(ctx)
  if (!scope) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { error } = await authSetPassword(ctx.sub, password)
  if (error) {
    console.error('[change-password]', error.message)
    return NextResponse.json({ ...(await apiErr('passwordChangeFailed')) }, { status: 400 })
  }
  await run(scope, sql => [sql`update public.users set must_change_password = false where id = ${ctx.sub}`])
  return startSession(ctx.email, password, request)
}
