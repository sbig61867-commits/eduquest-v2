import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { getCaller, staffCan } from '@/lib/staff-auth'
import { isAcademicMode } from '@/lib/structure-mode'

// Academic terms (semester / term / session / period — named per institution
// type). Same privileged-write pattern as ../units/route.ts: the caller (live,
// with the institution's structure) in one read, then the write as
// app_service pinned to the caller's institution.

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null
  return Number.isNaN(Date.parse(v)) ? null : v
}

type TermRow = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean }

// POST { name, starts_on, ends_on, is_current? }
export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) return NextResponse.json({ ...(await apiErr('nameRequired120')) }, { status: 400 })
  const starts = validDate(body.starts_on)
  const ends = validDate(body.ends_on)
  if (!starts || !ends || ends <= starts) {
    return NextResponse.json({ ...(await apiErr('endBeforeStart')) }, { status: 400 })
  }

  // One unit: only one current term per tenant (unique partial index), so the
  // others are cleared first, in the same transaction as the insert.
  const isCurrent = body.is_current === true
  try {
    const rows = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      ...(isCurrent ? [sql`update public.academic_terms set is_current = false where tenant_id = ${caller.tenant_id} and is_current`] : []),
      sql`insert into public.academic_terms (tenant_id, name, starts_on, ends_on, is_current)
          values (${caller.tenant_id}, ${name}, ${starts}, ${ends}, ${isCurrent})
          returning id, name, starts_on, ends_on, is_current`,
    ])
    return NextResponse.json({ term: maybeOne<TermRow>(rows[rows.length - 1]) }, { status: 201 })
  } catch (e) {
    console.error('[api/academic/terms POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('createFailed')) }, { status: 500 })
  }
}

// PATCH { id, name?, starts_on?, ends_on?, is_current? }
export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (typeof body.id !== 'string') return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  const id = body.id
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
  const scope = { as: 'service', tenantId: caller.tenant_id } as const

  const [found] = await run(scope, sql => [
    sql`select starts_on, ends_on from public.academic_terms
         where id = ${id} and tenant_id = ${caller.tenant_id} and deleted_at is null`,
  ])
  const existing = maybeOne<{ starts_on: string; ends_on: string }>(found)
  if (!existing) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })

  let name: string | null = null
  if (body.name !== undefined) {
    name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 120) return NextResponse.json({ ...(await apiErr('nameRequired120')) }, { status: 400 })
  }
  let starts: string | null = null
  let ends: string | null = null
  if (body.starts_on !== undefined || body.ends_on !== undefined) {
    starts = body.starts_on !== undefined ? validDate(body.starts_on) : existing.starts_on
    ends = body.ends_on !== undefined ? validDate(body.ends_on) : existing.ends_on
    if (!starts || !ends || ends <= starts) {
      return NextResponse.json({ ...(await apiErr('endBeforeStart')) }, { status: 400 })
    }
  }
  const current = body.is_current !== undefined ? body.is_current === true : null
  if (name === null && starts === null && current === null) {
    return NextResponse.json({ ...(await apiErr('nothingToUpdate')) }, { status: 400 })
  }

  try {
    const rows = await run(scope, sql => [
      ...(current === true ? [sql`update public.academic_terms set is_current = false
                                   where tenant_id = ${caller.tenant_id} and is_current and id <> ${id}`] : []),
      sql`update public.academic_terms set
            name = coalesce(${name}::text, name),
            starts_on = coalesce(${starts}::date, starts_on),
            ends_on = coalesce(${ends}::date, ends_on),
            is_current = coalesce(${current}::boolean, is_current)
          where id = ${id} and tenant_id = ${caller.tenant_id} and deleted_at is null
          returning id, name, starts_on, ends_on, is_current`,
    ])
    const term = maybeOne<TermRow>(rows[rows.length - 1])
    if (!term) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
    return NextResponse.json({ term })
  } catch (e) {
    console.error('[api/academic/terms PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('updateFailed')) }, { status: 500 })
  }
}

// DELETE { id } — archive
export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (typeof body.id !== 'string') return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  const id = body.id
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })

  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`update public.academic_terms set deleted_at = now(), is_current = false
           where id = ${id} and tenant_id = ${caller.tenant_id} and deleted_at is null
          returning id`,
    ])
    if (!maybeOne(rows)) return NextResponse.json({ ...(await apiErr('notFound')) }, { status: 404 })
  } catch (e) {
    console.error('[api/academic/terms DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('archiveFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
