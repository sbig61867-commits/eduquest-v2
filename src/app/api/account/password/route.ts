import { currentUser } from '@/lib/auth/current'
import { authSetPassword, authVerifyPassword } from '@/lib/auth/better'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { startSession } from '@/lib/auth/sign-in'
import { rateLimit } from '@/lib/rate-limit'

const MIN_PASSWORD_LENGTH = 8

// The settings page's "change password", for every role. Unlike
// /api/auth/change-password (the forced first change of a staff-created
// account), this one requires the CURRENT password: a session left open on a
// shared device must not be enough to take the account over.
//
// The current password is checked without opening a session. Setting the new
// one ends every session of the account (a stolen session dies with the old
// password), so the caller gets a fresh session on the new password.
export async function POST(request: Request) {
  const user = await currentUser()
  if (!user?.email) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  // Each attempt is a real sign-in against the current password: keep it tight.
  const rl = await rateLimit(`account-password:${user.id}`, { limit: 5, windowSecs: 900 })
  if (!rl.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  const body = await request.json().catch(() => ({}))
  const current = typeof body.current === 'string' ? body.current : ''
  const next = typeof body.next === 'string' ? body.next : ''
  if (!current) return NextResponse.json({ ...(await apiErr('currentPasswordWrong')) }, { status: 400 })
  if (next.length < MIN_PASSWORD_LENGTH) return NextResponse.json({ ...(await apiErr('passwordTooShort')) }, { status: 400 })
  if (next === current) return NextResponse.json({ ...(await apiErr('passwordSameAsCurrent')) }, { status: 400 })

  if ((await authVerifyPassword(user.email, current)) !== user.id) {
    return NextResponse.json({ ...(await apiErr('currentPasswordWrong')) }, { status: 400 })
  }

  const { error } = await authSetPassword(user.id, next)
  if (error) {
    console.error('[account-password]', error.message)
    return NextResponse.json({ ...(await apiErr('passwordChangeFailed')) }, { status: 400 })
  }
  return startSession(user.email, next, request)
}
