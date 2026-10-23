import { getSessionUser } from '@/lib/auth'
import { authRemoveUser } from '@/lib/auth/better'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// DELETE /api/admin/delete-tenant?id=<tenant_id>
// PERMANENT hard delete. super_admin only. Removes the university, all its users
// (sign-in accounts included), and every row that cascades from them — no
// orphans, no manual SQL. Use archive-tenant for reversible suspension instead.
export async function DELETE(request: Request) {
  const caller = await getSessionUser()
  if (!caller) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const [me] = await run({ as: 'user', userId: caller.id }, sql => [sql`select role from public.users where id = ${caller.id}`])
  if (maybeOne<{ role: string }>(me)?.role !== 'super_admin') {
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
  if (!tenantId || !UUID.test(tenantId)) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  // Platform scope: a verified super_admin acting across institutions.
  const platform = { as: 'service', platform: true } as const

  // 0. Every user of the tenant, read completely BEFORE anything is deleted, and
  //    in the same unit the invitations go: their invited_by/accepted_by FKs
  //    reference users about to be deleted. SQL has no row cap, so the list is
  //    whole; a failed read stops here with nothing deleted.
  let members: { id: string }[]
  try {
    const [rows] = await run(platform, sql => [
      sql`select id from public.users where tenant_id = ${tenantId} order by id`,
      sql`delete from public.invitations where tenant_id = ${tenantId}`,
    ])
    members = rows as unknown as { id: string }[]
  } catch (e) {
    console.error('[delete-tenant] list users:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('tenantUsersReadFailed')) }, { status: 500 })
  }

  // 1. Delete every account of the tenant. Each one cascades its profile and
  //    everything that hangs off it (groups, lessons, exams, submissions).
  let failed = 0
  for (const m of members) {
    const { error } = await authRemoveUser(m.id)
    if (error) { failed++; console.error('[delete-tenant] remove account', m.id, error.message) }
  }

  // 2. Delete the tenant itself (cascades feature_flags and any remaining rows).
  try {
    await run(platform, sql => [sql`delete from public.tenants where id = ${tenantId}`])
  } catch (e) {
    console.error('[delete-tenant] tenant delete:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('tenantDeleteFailed')) }, { status: 500 })
  }

  return NextResponse.json({ success: true, usersDeleted: members.length - failed, failed })
}
