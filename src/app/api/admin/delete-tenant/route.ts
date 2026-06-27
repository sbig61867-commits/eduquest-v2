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

// DELETE /api/admin/delete-tenant?id=<tenant_id>
// PERMANENT hard delete. super_admin only. Removes the university, all its users
// (auth identities included), and every row that cascades from them — no orphans,
// no manual SQL. Use archive-tenant for reversible suspension instead.
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user: caller } } = await supabase.auth.getUser()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('users').select('role').eq('id', caller.id).single()
  if (callerProfile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tenantId = new URL(request.url).searchParams.get('id')
  if (!tenantId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = adminClient()

  // 1. Remove invitations for this tenant first — their invited_by/accepted_by
  //    FKs reference users we are about to delete, so clearing them avoids any
  //    FK conflict regardless of how those constraints are configured.
  await admin.from('invitations').delete().eq('tenant_id', tenantId)

  // 2. Delete every user in the tenant via the Auth admin API. Deleting the auth
  //    identity cascades public.users and all their groups/lessons/exams/submissions.
  const { data: members, error: listErr } = await admin
    .from('users').select('id').eq('tenant_id', tenantId)
  if (listErr) {
    console.error('[delete-tenant] list users:', listErr)
    return NextResponse.json({ error: 'Failed to read university users' }, { status: 500 })
  }

  let failed = 0
  for (const m of members ?? []) {
    const { error } = await admin.auth.admin.deleteUser(m.id)
    if (error) { failed++; console.error('[delete-tenant] deleteUser', m.id, error.message) }
  }

  // 3. Delete the tenant itself (cascades feature_flags and any remaining rows).
  const { error: tenantErr } = await admin.from('tenants').delete().eq('id', tenantId)
  if (tenantErr) {
    console.error('[delete-tenant] tenant delete:', tenantErr)
    return NextResponse.json({ error: 'Failed to delete university' }, { status: 500 })
  }

  return NextResponse.json({ success: true, usersDeleted: (members?.length ?? 0) - failed, failed })
}
