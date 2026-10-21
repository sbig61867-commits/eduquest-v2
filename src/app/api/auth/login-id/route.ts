import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { isMemberCode, normalizeMemberCode } from '@/lib/member-login'
import { captchaTokenFrom, isCaptchaError } from '@/lib/captcha'

// Per ID: the brute-force guard for one account. Per IP: only a ceiling on
// spraying many IDs, set high enough for a whole class signing in from one
// school network (one public IP).
const LIMITS = [
  { scope: 'code', limit: 10, windowSecs: 900 },
  { scope: 'ip', limit: 120, windowSecs: 900 },
] as const

// Sign in with a member ID + password. The ID is resolved to the account's
// auth email on the server only — the response never reveals it, and an
// unknown ID fails exactly like a wrong password.
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const body = await request.json().catch(() => ({}))
  const code = normalizeMemberCode(typeof body.code === 'string' ? body.code : '')
  const password = typeof body.password === 'string' ? body.password : ''
  if (!isMemberCode(code) || !password) {
    return NextResponse.json({ ...(await apiErr('invalidLogin')) }, { status: 400 })
  }

  for (const { scope, limit, windowSecs } of LIMITS) {
    const rl = await rateLimit(`login-id:${scope}:${scope === 'ip' ? ip : code}`, { limit, windowSecs })
    if (!rl.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })
  }

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: member } = await admin.from('users').select('id, email').eq('member_code', code).maybeSingle()
  if (!member) return NextResponse.json({ ...(await apiErr('invalidLogin')) }, { status: 401 })

  // The auth email is the source of truth (public.users.email is a copy).
  const { data: auth } = await admin.auth.admin.getUserById(member.id)
  const email = auth?.user?.email ?? member.email
  if (!email) return NextResponse.json({ ...(await apiErr('invalidLogin')) }, { status: 401 })

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email, password, options: { captchaToken: captchaTokenFrom(body) },
  })
  if (isCaptchaError(error)) return NextResponse.json({ ...(await apiErr('captchaFailed')) }, { status: 400 })
  if (error || !data.user) return NextResponse.json({ ...(await apiErr('invalidLogin')) }, { status: 401 })

  return NextResponse.json({
    role: data.user.app_metadata?.user_role ?? null,
    mustChangePassword: data.user.app_metadata?.must_change_password === true,
  })
}
