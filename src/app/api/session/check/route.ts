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

  const { data: profile } = await admin
    .from('users')
    .select('is_active, deleted_at, tenant_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ ok: false, reason: 'no_profile' })
  if (profile.deleted_at) return NextResponse.json({ ok: false, reason: 'user_deleted' })
  if (profile.is_active === false) return NextResponse.json({ ok: false, reason: 'user_disabled' })

  // super_admin has no tenant to check.
  if (profile.role === 'super_admin' || !profile.tenant_id) {
    return NextResponse.json({ ok: true })
  }

  const { data: tenant } = await admin
    .from('universities')
    .select('deleted_at, subscription_status')
    .eq('id', profile.tenant_id)
    .single()

  if (!tenant) return NextResponse.json({ ok: false, reason: 'tenant_missing' })
  if (tenant.deleted_at) return NextResponse.json({ ok: false, reason: 'tenant_deleted' })
  if (tenant.subscription_status && tenant.subscription_status !== 'active') {
    return NextResponse.json({ ok: false, reason: 'tenant_suspended' })
  }

  return NextResponse.json({ ok: true })
}
