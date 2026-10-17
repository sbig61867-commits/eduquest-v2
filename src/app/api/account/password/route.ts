import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

const MIN_PASSWORD_LENGTH = 8

// The settings page's "change password", for every role. Unlike
// /api/auth/change-password (the forced first change of a staff-created
// account), this one requires the CURRENT password: a session left open on a
// shared device must not be enough to take the account over.
//
// The current password is checked by signing in with it on a throwaway client
// (no cookies); that extra session is signed out at once (scope 'local', so the
// caller's own session is untouched). The write goes through the service role
// after the session check, like the other account routes.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

  const verifier = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: check, error: checkError } = await verifier.auth.signInWithPassword({ email: user.email, password: current })
  if (checkError || check?.user?.id !== user.id) {
    return NextResponse.json({ ...(await apiErr('currentPasswordWrong')) }, { status: 400 })
  }
  await verifier.auth.signOut({ scope: 'local' })

  const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: next })
  if (error) {
    console.error('[account-password]', error.message)
    return NextResponse.json({ ...(await apiErr('passwordChangeFailed')) }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
