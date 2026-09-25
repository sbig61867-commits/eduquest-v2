import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { resetPasswordRedirectTo } from '@/lib/auth-urls'
import { getLocale } from 'next-intl/server'
import { isLocale, toLocale } from '@/i18n/config'

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
    return NextResponse.json({ ...(await apiErr('badRequest')) }, { status: 400 })
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ...(await apiErr('invalidEmail')) }, { status: 400 })
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

  const admin = adminClient()

  // The reset email is rendered by Supabase from supabase/templates/recovery.html,
  // which picks Arabic or English from the user's auth user_metadata.locale. Set
  // it first: the user's own choice → their institution's default → the
  // language of the page the reset was requested from. user_metadata is a
  // display preference only (no authorization reads it), and the update merges
  // keys, so nothing else in the metadata is touched. A failure here must never
  // block the reset itself — the template falls back to Arabic.
  try {
    const { data: row } = await admin
      .from('users').select('id, locale, tenants(default_locale)').eq('email', email).maybeSingle()
    if (row) {
      const tenant = (row as { tenants?: { default_locale?: unknown } | null }).tenants
      const locale = isLocale(row.locale) ? row.locale
        : isLocale(tenant?.default_locale) ? tenant.default_locale
        : toLocale(await getLocale())
      await admin.auth.admin.updateUserById(row.id, { user_metadata: { locale } })
    }
  } catch (e) {
    console.error('[forgot-password] could not set the email language:', e)
  }

  // We don't check whether the email exists — always attempt and always return the
  // same message. Supabase itself is a no-op for unknown emails so this is safe.
  await admin.auth.resetPasswordForEmail(email, { redirectTo })

  return NextResponse.json({ message: SENT_MSG }, { status: 200 })
}
