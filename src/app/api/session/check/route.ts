import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// GET /api/session/check — cheap liveness check for the user's session.
// Called every 60s by <TenantWatcher>. Returns { ok: true } if the user's
// account AND their tenant are both usable; otherwise { ok: false, reason }.
//
// Uses the service-role client so it works even when RLS wouldn't let the
// student read their tenant row directly. Only reads scalar flags — never
// leaks tenant data to the client.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, reason: 'no_session' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: profile, error: profileErr } = await admin
    .from('users')
    .select('is_active, tenant_id, role')
    .eq('id', user.id)
    .single()

  // Distinguish "row really gone" (user hard-deleted → kick) from a transient
  // query error (→ don't kick anyone; watcher retries next tick).
  if (profileErr && profileErr.code !== 'PGRST116') {
    console.error('[session/check] profile query:', profileErr)
    return NextResponse.json({ ok: true, degraded: true })
  }
  if (!profile) return NextResponse.json({ ok: false, reason: 'user_deleted' })
  if (profile.is_active === false) return NextResponse.json({ ok: false, reason: 'user_disabled' })

  // super_admin has no tenant to check.
  if (profile.role === 'super_admin' || !profile.tenant_id) {
    return NextResponse.json({ ok: true })
  }

  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .select('is_active')
    .eq('id', profile.tenant_id)
    .single()

  if (tenantErr && tenantErr.code !== 'PGRST116') {
    console.error('[session/check] tenant query:', tenantErr)
    return NextResponse.json({ ok: true, degraded: true })
  }
  if (!tenant) return NextResponse.json({ ok: false, reason: 'tenant_deleted' })
  if (tenant.is_active === false) return NextResponse.json({ ok: false, reason: 'tenant_suspended' })

  return NextResponse.json({ ok: true })
}
