import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { resetPasswordRedirectTo } from '@/lib/auth-urls'

// Generic message — identical whether email exists or not (prevents enumeration)
const SENT_MSG = 'If that email is registered, you will receive a reset link shortly.'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  // Rate limit by IP — 5 attempts per hour prevents bulk enumeration
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ipLimit = await rateLimit(`forgot-password:ip:${ip}`, { limit: 5, windowSecs: 3600 })
  if (!ipLimit.allowed) {
    return NextResponse.json({ message: SENT_MSG }, { status: 200 })
  }

  let email: string
  try {
    const body = await request.json()
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  // Rate limit by email — 3 attempts per hour prevents email spam to one address
  const emailLimit = await rateLimit(`forgot-password:email:${email}`, { limit: 3, windowSecs: 3600 })
  if (!emailLimit.allowed) {
    return NextResponse.json({ message: SENT_MSG }, { status: 200 })
  }

  // Use admin client so we can call resetPasswordForEmail without a session.
  // redirectTo points to our callback which validates the `next` param — no open
  // redirect. Base URL resolution never trusts a stale/localhost env in prod
  // (see src/lib/auth-urls.ts). NOTE: this exact URL (with ?next=) must match
  // the Supabase Redirect URLs allow list — the `?**` wildcard entries cover it;
  // otherwise Supabase silently falls back to the Site URL.
  const redirectTo = resetPasswordRedirectTo(request.url, process.env.NEXT_PUBLIC_APP_URL)

  // We don't check whether the email exists — always attempt and always return the
  // same message. Supabase itself is a no-op for unknown emails so this is safe.
  await adminClient().auth.resetPasswordForEmail(email, { redirectTo })

  return NextResponse.json({ message: SENT_MSG }, { status: 200 })
}
