import { getSessionUser } from '@/lib/auth'
import { setAuthPassword, verifyPassword } from '@/lib/auth/admin'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

// Replaces the signed-in user's password and clears the
// `must_change_password` flag that staff-created accounts start with.
// The client refreshes its session afterwards so the JWT drops the flag.
export async function POST(request: Request) {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const rl = await rateLimit(`change-password:${user.id}`, { limit: 10, windowSecs: 3600 })
  if (!rl.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  const body = await request.json().catch(() => ({}))
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 8) return NextResponse.json({ ...(await apiErr('passwordTooShort')) }, { status: 400 })

  // The new password may not be the temporary one.
  if (await verifyPassword(user.email!, password)) return NextResponse.json({ ...(await apiErr('passwordUnchanged')) }, { status: 400 })

  const { error } = await setAuthPassword(getAdminDb(), user.id, password, { mustChangePassword: false })
  if (error) {
    console.error('[change-password]', error)
    return NextResponse.json({ ...(await apiErr('passwordChangeFailed')) }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
