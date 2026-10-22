import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { isMemberCode, normalizeMemberCode } from '@/lib/member-login'
import { captchaTokenFrom, ipLimitFor, type TieredLimit } from '@/lib/captcha'

// Per ID: the brute-force guard for one account, whatever the caller proves.
const CODE_LIMIT = { limit: 10, windowSecs: 900 }
// Per IP: a ceiling on spraying many IDs. A whole class signs in from one
// school IP, so a verified Turnstile token earns the classroom-sized bucket;
// without one the pre-Turnstile limit applies (src/lib/captcha.ts).
const IP_LIMITS: TieredLimit = {
  human: { limit: 120, windowSecs: 900 },
  strict: { limit: 10, windowSecs: 900 },
}

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

  const byCode = await rateLimit(`login-id:code:${code}`, CODE_LIMIT)
  if (!byCode.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })
  const { key, ...ipLimit } = await ipLimitFor('login-id', ip, captchaTokenFrom(body), IP_LIMITS)
  const byIp = await rateLimit(key, ipLimit)
  if (!byIp.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  const admin = getAdminDb()
  const { data: member } = await admin.from('users').select('id, email').eq('member_code', code).maybeSingle()
  if (!member) return NextResponse.json({ ...(await apiErr('invalidLogin')) }, { status: 401 })

  // The auth email is the source of truth (public.users.email is a copy).
  const { data: auth } = await admin.auth.admin.getUserById(member.id)
  const email = auth?.user?.email ?? member.email
  if (!email) return NextResponse.json({ ...(await apiErr('invalidLogin')) }, { status: 401 })

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) return NextResponse.json({ ...(await apiErr('invalidLogin')) }, { status: 401 })

  return NextResponse.json({
    role: data.user.app_metadata?.user_role ?? null,
    mustChangePassword: data.user.app_metadata?.must_change_password === true,
  })
}
