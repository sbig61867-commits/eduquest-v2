import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { run, maybeOne } from '@/lib/db/sql'
import { ownerCaller, ownerGate } from '@/lib/owner-gate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The owner's feature flags (/super-admin/features). Written as the owner, and
// the statement itself re-checks the owner's live role.
export async function POST(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as { name?: unknown; tenant_id?: unknown; is_enabled?: unknown } | null
  const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 80) : ''
  const tenantId = b?.tenant_id ? String(b.tenant_id) : null
  if (!name || (tenantId && !UUID.test(tenantId))) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`insert into public.feature_flags (name, tenant_id, is_enabled)
          select ${name}, ${tenantId}, ${b?.is_enabled !== false} where ${ownerGate(sql, me.id)}
          returning id, name, is_enabled, tenant_id, created_at`,
    ])
    const row = maybeOne(rows)
    return row ? NextResponse.json(row) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/feature-flags POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}

/** PATCH { id, is_enabled } — switch one flag. */
export async function PATCH(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as { id?: unknown; is_enabled?: unknown } | null
  const id = String(b?.id ?? '')
  if (!UUID.test(id) || typeof b?.is_enabled !== 'boolean') return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`update public.feature_flags set is_enabled = ${b!.is_enabled as boolean} where id = ${id} and ${ownerGate(sql, me.id)}
          returning id, name, is_enabled, tenant_id, created_at`,
    ])
    const row = maybeOne(rows)
    return row ? NextResponse.json(row) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/feature-flags PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}

/** DELETE ?id= — remove one flag. */
export async function DELETE(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`delete from public.feature_flags where id = ${id} and ${ownerGate(sql, me.id)} returning id`,
    ])
    return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/feature-flags DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
