import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { isLocale } from '@/i18n/config'

// PATCH /api/account/locale { locale } — the signed-in user's language
// preference (components/shared/locale-switcher.tsx), so it follows them to
// another device: src/proxy.ts reads it into the cookie when none is set. A
// plain self-update as the user (RLS allows the own row; the authorization
// columns are pinned in users_update WITH CHECK).
export async function PATCH(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const body = await request.json().catch(() => null) as { locale?: unknown } | null
  if (!isLocale(body?.locale)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  const locale = body!.locale as string
  try {
    await run({ as: 'user', userId: user.id }, sql => [
      sql`update public.users set locale = ${locale} where id = ${user.id}`,
    ])
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[account/locale]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
