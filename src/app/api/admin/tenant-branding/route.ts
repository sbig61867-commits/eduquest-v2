import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { isLocale } from '@/i18n/config'

// PATCH /api/admin/tenant-branding  { name, logo_url, default_locale? }
//
// Why this route exists: admin/settings-client.tsx used to update `tenants`
// straight from the browser, but `tenants` only has a super_admin write
// policy — so for a university_admin the update matched 0 rows, returned no
// error, and the page showed "saved" while nothing changed (verified
// 2026-09-13 in a rolled-back transaction). A plain RLS policy is not the
// fix: RLS cannot restrict columns, and `tenants.is_active` must never be
// writable by the tenant's own admin (a suspended university could un-suspend
// itself). So the write runs here as app_service, and only the branding
// columns and the institution's default language are ever touched.
// default_locale (emails, and the interface of anyone who has not picked a
// language) is optional: left out, it is not changed.
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!ctx.tenant_id || ctx.role !== 'university_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { name?: unknown; logo_url?: unknown; default_locale?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ ...(await apiErr('tenantNameRequired')) }, { status: 400 })
  if (name.length > 120) return NextResponse.json({ ...(await apiErr('tenantNameTooLong')) }, { status: 400 })

  const rawLogo = typeof body.logo_url === 'string' ? body.logo_url.trim() : ''
  let logoUrl: string | null = null
  if (rawLogo) {
    let parsed: URL
    try { parsed = new URL(rawLogo) } catch { return NextResponse.json({ ...(await apiErr('logoUrlInvalid')) }, { status: 400 }) }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return NextResponse.json({ ...(await apiErr('logoUrlScheme')) }, { status: 400 })
    }
    if (rawLogo.length > 2048) return NextResponse.json({ ...(await apiErr('logoUrlTooLong')) }, { status: 400 })
    logoUrl = parsed.toString()
  }

  if (body.default_locale !== undefined && !isLocale(body.default_locale)) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  const locale = isLocale(body.default_locale) ? body.default_locale : null

  // One statement, pinned to the caller's institution: the tenant is the
  // caller's own LIVE institution (never the request body), and only while
  // they are still its active admin.
  try {
    const [rows] = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
      sql`with me as (
            select tenant_id from public.users
             where id = ${ctx.sub} and role = 'university_admin' and is_active is not false
          )
          update public.tenants t
             set name = ${name}, logo_url = ${logoUrl}, default_locale = coalesce(${locale}::text, t.default_locale)
            from me
           where t.id = me.tenant_id
          returning t.id, t.name, t.logo_url, t.default_locale`,
    ])
    const tenant = maybeOne(rows)
    if (!tenant) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json({ tenant })
  } catch (e) {
    console.error('[api/admin/tenant-branding PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('settingsSaveFailed')) }, { status: 500 })
  }
}
