import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminDb } from '@/lib/db'

function adminClient() {
  return getAdminDb()
}

// POST /api/admin/archive-tenant  body: { tenant_id, archive: boolean }
// Archiving deactivates the university AND every user inside it, so none of them
// can log in (is_active flows into the JWT via the sync_user_claims trigger, which
// the auth proxy enforces). No data is deleted.
//
// The user cascade is done by the DB trigger on_tenant_active_change
// (supabase/fix_admin_user_escalation_migration.sql), NOT here: it marks the
// accounts the suspension switched off (users.suspended_by_tenant) and a
// restore re-activates only those — an account disabled individually before
// the suspension stays disabled. A blanket users update here would undo that.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user: caller } } = await supabase.auth.getUser()
  if (!caller) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('users').select('role').eq('id', caller.id).single()
  if (callerProfile?.role !== 'super_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { tenant_id?: string; archive?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { tenant_id, archive } = body
  if (!tenant_id || typeof archive !== 'boolean') {
    return NextResponse.json({ ...(await apiErr('tenantIdAndArchiveRequired')) }, { status: 400 })
  }

  const admin = adminClient()
  const nextActive = !archive  // archive=true -> is_active=false

  // 1. Flip the tenant's active flag
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants').update({ is_active: nextActive }).eq('id', tenant_id).select().single()
  if (tenantErr || !tenant) {
    console.error('[archive-tenant] tenant update:', tenantErr)
    return NextResponse.json({ ...(await apiErr('tenantUpdateFailed')) }, { status: 500 })
  }

  return NextResponse.json({ tenant, archived: archive })
}
