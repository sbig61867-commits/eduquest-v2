import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminDb } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { IncompleteReadError, readAllByKeyset, READ_PAGE } from '@/lib/data/complete-read'

function adminClient() {
  return getAdminDb()
}

// DELETE /api/admin/delete-tenant?id=<tenant_id>
// PERMANENT hard delete. super_admin only. Removes the university, all its users
// (auth identities included), and every row that cascades from them — no orphans,
// no manual SQL. Use archive-tenant for reversible suspension instead.
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user: caller } } = await supabase.auth.getUser()
  if (!caller) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('users').select('role').eq('id', caller.id).single()
  if (callerProfile?.role !== 'super_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Catastrophic + irreversible: cap it even for super_admin, mainly as a
  // circuit breaker against a compromised session or a scripting mistake.
  const rl = await rateLimit(`delete-tenant:${caller.id}`, { limit: 5, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  const tenantId = new URL(request.url).searchParams.get('id')
  if (!tenantId) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const admin = adminClient()

  // 0. Every user of the tenant, read completely BEFORE anything is deleted: an
  //    institution can pass the API's 1000-row cap, and a cut list used to delete
  //    the first 1000 accounts and orphan the rest. A failed or short read stops
  //    here, with nothing deleted.
  let members: { id: string }[]
  try {
    members = await readAllByKeyset<{ id: string }>('tenant users',
      after => admin.from('users').select('id').eq('tenant_id', tenantId).gt('id', after).order('id').limit(READ_PAGE),
      () => admin.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId))
  } catch (e) {
    if (!(e instanceof IncompleteReadError)) throw e
    console.error('[delete-tenant] list users:', e.message, e.detail ?? '')
    return NextResponse.json({ ...(await apiErr('tenantUsersReadFailed')) }, { status: 500 })
  }

  // 1. Remove invitations for this tenant first — their invited_by/accepted_by
  //    FKs reference users we are about to delete, so clearing them avoids any
  //    FK conflict regardless of how those constraints are configured.
  await admin.from('invitations').delete().eq('tenant_id', tenantId)

  // 2. Delete every user in the tenant via the Auth admin API. Deleting the auth
  //    identity cascades public.users and all their groups/lessons/exams/submissions.

  let failed = 0
  for (const m of members) {
    const { error } = await admin.auth.admin.deleteUser(m.id)
    if (error) { failed++; console.error('[delete-tenant] deleteUser', m.id, error.message) }
  }

  // 3. Delete the tenant itself (cascades feature_flags and any remaining rows).
  const { error: tenantErr } = await admin.from('tenants').delete().eq('id', tenantId)
  if (tenantErr) {
    console.error('[delete-tenant] tenant delete:', tenantErr)
    return NextResponse.json({ ...(await apiErr('tenantDeleteFailed')) }, { status: 500 })
  }

  return NextResponse.json({ success: true, usersDeleted: members.length - failed, failed })
}
