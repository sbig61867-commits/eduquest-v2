import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { authResetPassword } from '@/lib/auth/better'
import { rateLimit } from '@/lib/rate-limit'

const MIN_PASSWORD_LENGTH = 8

// POST /api/auth/reset-password { token, password } — the last step of "forgot
// password". The one-time token from the email is the authorization (no
// session); a success ends every session of the account, and the user signs
// in again with the new password.
export async function POST(request: Request) {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const limit = await rateLimit(`reset-password:ip:${ip}`, { limit: 20, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  const body = await request.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < MIN_PASSWORD_LENGTH) return NextResponse.json({ ...(await apiErr('passwordTooShort')) }, { status: 400 })
  if (!token || !(await authResetPassword(token, password))) {
    return NextResponse.json({ ...(await apiErr('resetLinkInvalid')) }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
