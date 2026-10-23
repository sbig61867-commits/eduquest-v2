import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run } from '@/lib/db/sql'

const KINDS = new Set(['group', 'lesson', 'exam', 'course'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/admin/restore — un-archive an entity (university_admin / super_admin).
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!['university_admin', 'super_admin'].includes(ctx.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { kind?: string; id?: string; tenant_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  if (!body.id || !body.kind || !KINDS.has(body.kind) || !UUID.test(body.id)) {
    return NextResponse.json({ ...(await apiErr('invalidTypeOrId')) }, { status: 400 })
  }

  // super_admin has no tenant_id of their own (legitimately NULL — they are
  // cross-tenant), so they must explicitly say which tenant's entity to
  // restore, same pattern as /api/admin/create-user. university_admin is
  // always scoped to their own tenant — a client-supplied tenant_id in the
  // body is ignored for that role, not honored, so they can never target
  // another tenant by tampering with the request.
  const isOwner = ctx.role === 'super_admin'
  const tenant_id = isOwner ? (body.tenant_id ?? null) : ctx.tenant_id
  if (!tenant_id || !UUID.test(tenant_id)) {
    return NextResponse.json({ ...(await apiErr('tenantIdRequired')) }, { status: 400 })
  }

  // restore_entity re-derives the actor's role and institution from
  // public.users and refuses a mismatch; the owner runs in platform scope,
  // an institution admin pinned to their own institution.
  const kind = body.kind
  const id = body.id
  try {
    await run(isOwner ? { as: 'service', platform: true } : { as: 'service', tenantId: tenant_id }, sql => [
      sql`select public.restore_entity(p_kind => ${kind}, p_id => ${id}, p_tenant_id => ${tenant_id}, p_actor => ${ctx.sub})`,
    ])
  } catch (e) {
    console.error('[api/admin/restore]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('restoreFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
