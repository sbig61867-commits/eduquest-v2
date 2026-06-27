import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/admin/archive-tenant  body: { tenant_id, archive: boolean }
// Archiving deactivates the university AND every user inside it, so none of them
// can log in (is_active flows into the JWT via the sync_user_claims trigger, which
// the auth proxy enforces). No data is deleted — restoring re-activates everything.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user: caller } } = await supabase.auth.getUser()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('users').select('role').eq('id', caller.id).single()
  if (callerProfile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { tenant_id?: string; archive?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { tenant_id, archive } = body
  if (!tenant_id || typeof archive !== 'boolean') {
    return NextResponse.json({ error: 'tenant_id and archive (boolean) are required' }, { status: 400 })
  }

  const admin = adminClient()
  const nextActive = !archive  // archive=true -> is_active=false

  // 1. Flip the tenant's active flag
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants').update({ is_active: nextActive }).eq('id', tenant_id).select().single()
  if (tenantErr || !tenant) {
    console.error('[archive-tenant] tenant update:', tenantErr)
    return NextResponse.json({ error: 'Failed to update university' }, { status: 500 })
  }

  // 2. Cascade the same flag to every user in the tenant (blocks/restores their login).
  //    Goes through public.users so the sync_user_claims trigger re-syncs the JWT claim.
  const { error: usersErr } = await admin
    .from('users').update({ is_active: nextActive }).eq('tenant_id', tenant_id)
  if (usersErr) {
    console.error('[archive-tenant] users update:', usersErr)
    return NextResponse.json({ error: 'University updated but failed to update its users' }, { status: 500 })
  }

  return NextResponse.json({ tenant, archived: archive })
}
