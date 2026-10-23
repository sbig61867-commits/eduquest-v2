import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/admin/archive-tenant  body: { tenant_id, archive: boolean }
// Archiving deactivates the university AND every user inside it, so none of them
// can sign in (is_active is checked live by the proxy on every write and on the
// session refresh). No data is deleted.
//
// The user cascade is done by the DB trigger on_tenant_active_change
// (supabase/fix_admin_user_escalation_migration.sql), NOT here: it marks the
// accounts the suspension switched off (users.suspended_by_tenant) and a
// restore re-activates only those — an account disabled individually before
// the suspension stays disabled. A blanket users update here would undo that.
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { tenant_id?: string; archive?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { tenant_id, archive } = body
  if (!tenant_id || typeof archive !== 'boolean') {
    return NextResponse.json({ ...(await apiErr('tenantIdAndArchiveRequired')) }, { status: 400 })
  }
  if (!UUID.test(tenant_id)) return NextResponse.json({ ...(await apiErr('tenantUpdateFailed')) }, { status: 500 })

  // One unit, platform scope (the owner is cross-tenant): the flag flips only
  // while the caller is still an active super_admin.
  try {
    const [rows] = await run({ as: 'service', platform: true }, sql => [
      sql`update public.tenants set is_active = ${!archive}
           where id = ${tenant_id}
             and exists (select 1 from public.users where id = ${ctx.sub} and role = 'super_admin' and is_active is not false)
          returning *`,
    ])
    const tenant = maybeOne<Row>(rows)
    if (!tenant) return NextResponse.json({ ...(await apiErr('tenantUpdateFailed')) }, { status: 500 })
    return NextResponse.json({ tenant, archived: archive })
  } catch (e) {
    console.error('[archive-tenant] tenant update:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('tenantUpdateFailed')) }, { status: 500 })
  }
}
