import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { getCaller, staffCan } from '@/lib/staff-auth'
import { isAcademicMode } from '@/lib/structure-mode'

// Academic units (level 1 = faculty/stage/track…, level 2 = department/grade…).
// Capability `manage_academic_structure` is checked on the caller's live row
// (read with the institution's structure), then the write runs as app_service
// pinned to the caller's institution — the tables have a SELECT policy only
// for users (academic_structure_migration.sql). The DB triggers additionally
// reject any cross-tenant parent, so the tenant check here is defence in depth.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function authorize() {
  const res = await getCaller()
  if ('error' in res) return res
  if (!staffCan(res.caller, 'manage_academic_structure')) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  // Tenants on the original ('flat') structure can't touch this at all.
  if (!isAcademicMode(res.caller.structure_mode)) {
    return { error: NextResponse.json({ ...(await apiErr('academicDisabled')) }, { status: 409 }) }
  }
  return res
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() } catch { return null }
}

function cleanName(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length >= 1 && s.length <= 120 ? s : null
}

function cleanCode(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const s = String(v).trim()
  return s.length <= 30 ? s : undefined
}

type UnitRow = { id: string; parent_id: string | null; level: number; name: string; code: string | null; sort_order: number }

// POST { name, code?, parent_id? } — parent_id makes it a level-2 unit
export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  const body = await readBody(request)
  if (!body) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })

  const name = cleanName(body.name)
  if (!name) return NextResponse.json({ ...(await apiErr('nameRequired120')) }, { status: 400 })
  const code = cleanCode(body.code)
  if (code === undefined && body.code !== undefined) {
    return NextResponse.json({ ...(await apiErr('codeTooLong')) }, { status: 400 })
  }

  const parentId = typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null
  if (parentId && !UUID.test(parentId)) return NextResponse.json({ ...(await apiErr('parentUnitNotFound')) }, { status: 404 })
  const sortOrder = Number.isInteger(body.sort_order) ? (body.sort_order as number) : 0

  // One unit: the parent as it stands (for a precise refusal), then the
  // insert — a level-2 unit only under a live level-1 unit of this institution.
  try {
    const [parentRows, created] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`select level from public.academic_units
           where id = ${parentId}::uuid and tenant_id = ${caller.tenant_id} and deleted_at is null`,
      sql`insert into public.academic_units (tenant_id, parent_id, level, name, code, sort_order)
          select ${caller.tenant_id}, ${parentId}::uuid, ${parentId ? 2 : 1}, ${name}, ${code ?? null}, ${sortOrder}
           where ${parentId}::uuid is null
              or exists (select 1 from public.academic_units p
                          where p.id = ${parentId}::uuid and p.tenant_id = ${caller.tenant_id} and p.deleted_at is null and p.level = 1)
          returning id, parent_id, level, name, code, sort_order`,
    ])
    const unit = maybeOne<UnitRow>(created)
    if (unit) return NextResponse.json({ unit }, { status: 201 })
    const parent = maybeOne<{ level: number }>(parentRows)
    if (!parent) return NextResponse.json({ ...(await apiErr('parentUnitNotFound')) }, { status: 404 })
    return NextResponse.json({ ...(await apiErr('noThirdLevel')) }, { status: 400 })
  } catch (e) {
    console.error('[api/academic/units POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('createFailed')) }, { status: 500 })
  }
}

// PATCH { id, name?, code?, sort_order? } — the parent is never re-assigned
export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  const body = await readBody(request)
  if (!body || typeof body.id !== 'string') return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  const id = body.id
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })

  let name: string | null = null
  if (body.name !== undefined) {
    name = cleanName(body.name)
    if (!name) return NextResponse.json({ ...(await apiErr('nameRequired120')) }, { status: 400 })
  }
  let code: string | null | undefined
  if (body.code !== undefined) {
    code = cleanCode(body.code)
    if (code === undefined) return NextResponse.json({ ...(await apiErr('codeTooLong')) }, { status: 400 })
  }
  if (body.sort_order !== undefined && !Number.isInteger(body.sort_order)) {
    return NextResponse.json({ ...(await apiErr('invalidOrder')) }, { status: 400 })
  }
  const sortOrder = body.sort_order !== undefined ? (body.sort_order as number) : null
  if (name === null && body.code === undefined && sortOrder === null) {
    return NextResponse.json({ ...(await apiErr('nothingToUpdate')) }, { status: 400 })
  }

  // One statement: a unit of another institution, or an archived one, is not found.
  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`update public.academic_units set
            name = coalesce(${name}::text, name),
            code = case when ${body.code !== undefined} then ${code ?? null}::text else code end,
            sort_order = coalesce(${sortOrder}::int, sort_order)
          where id = ${id} and tenant_id = ${caller.tenant_id} and deleted_at is null
          returning id, parent_id, level, name, code, sort_order`,
    ])
    const unit = maybeOne<UnitRow>(rows)
    if (!unit) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
    return NextResponse.json({ unit })
  } catch (e) {
    console.error('[api/academic/units PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('updateFailed')) }, { status: 500 })
  }
}

// DELETE { id } — archives (soft delete) the unit and its children; links on
// groups/courses stay in place and simply stop resolving in the UI.
export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  const body = await readBody(request)
  if (!body || typeof body.id !== 'string') return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  const id = body.id
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })

  // One statement: the unit (live, this institution) and its live children.
  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`update public.academic_units set deleted_at = now()
           where tenant_id = ${caller.tenant_id} and deleted_at is null
             and (id = ${id} or parent_id = ${id})
             and exists (select 1 from public.academic_units x
                          where x.id = ${id} and x.tenant_id = ${caller.tenant_id} and x.deleted_at is null)
          returning id`,
    ])
    if (!rows.length) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
  } catch (e) {
    console.error('[api/academic/units DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('archiveFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
