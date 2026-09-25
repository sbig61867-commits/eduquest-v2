import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// PATCH /api/admin/tenant-branding  { name, logo_url }
//
// Why this route exists: admin/settings-client.tsx used to update `tenants`
// straight from the browser, but `tenants` only has a super_admin write
// policy — so for a university_admin the update matched 0 rows, returned no
// error, and the page showed "saved" while nothing changed (verified
// 2026-09-13 in a rolled-back transaction). A plain RLS policy is not the
// fix: RLS cannot restrict columns, and `tenants.is_active` must never be
// writable by the tenant's own admin (a suspended university could un-suspend
// itself). So the write goes through the service-role client here, and only
// the two branding columns are ever touched.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id || profile.role !== 'university_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { name?: unknown; logo_url?: unknown }
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

  // Tenant comes from the caller's own profile — never from the request body.
  const { data, error } = await adminClient()
    .from('tenants')
    .update({ name, logo_url: logoUrl })
    .eq('id', profile.tenant_id)
    .select('id, name, logo_url')
    .single()

  if (error || !data) {
    console.error('[api/admin/tenant-branding PATCH]', error)
    return NextResponse.json({ ...(await apiErr('settingsSaveFailed')) }, { status: 500 })
  }
  return NextResponse.json({ tenant: data })
}
