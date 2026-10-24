import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { run, maybeOne } from '@/lib/db/sql'
import { ownerCaller, ownerGate } from '@/lib/owner-gate'
import { isInstitutionType } from '@/lib/terminology'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9-]{2,60}$/
const CODE = /^[A-Z0-9]{2,6}$/

/** A seat or storage limit: null (no cap) or a non-negative whole number. */
const limit = (v: unknown): number | null | undefined =>
  v === null ? null : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000 ? (v as number) : undefined

// The owner's institution settings (/super-admin/tenants). Every write is the
// owner's, re-checked against the live row inside the statement; an
// institution can never raise its own limit (tenants_manage: super_admin only).

/** POST { name, slug?, institution_type?, has_center? } — a new institution. */
export async function POST(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as { name?: unknown; slug?: unknown; institution_type?: unknown; has_center?: unknown } | null
  const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 200) : ''
  const slug = typeof b?.slug === 'string' ? b.slug : ''
  const type = isInstitutionType(b?.institution_type) ? b!.institution_type as string : 'university'
  const hasCenter = b?.has_center !== false
  if (!name || !SLUG.test(slug)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`insert into public.tenants (name, slug, institution_type, has_center)
          select ${name}, ${slug}, ${type}, ${hasCenter} where ${ownerGate(sql, me.id)}
          returning *`,
    ])
    const row = maybeOne(rows)
    return row ? NextResponse.json(row) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === '23505') return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 409 })
    console.error('[super-admin/tenants POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}

/**
 * PATCH { id, …fields } — change only the fields sent. Allowed: student_limit,
 * teacher_limit, storage_limit_mb, institution_type, code, has_center, structure_mode.
 */
export async function PATCH(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as Record<string, unknown> | null
  const id = String(b?.id ?? '')
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })

  const f = {
    student_limit: 'student_limit' in (b ?? {}) ? limit(b!.student_limit) : undefined,
    teacher_limit: 'teacher_limit' in (b ?? {}) ? limit(b!.teacher_limit) : undefined,
    storage_limit_mb: 'storage_limit_mb' in (b ?? {}) ? limit(b!.storage_limit_mb) : undefined,
    institution_type: 'institution_type' in (b ?? {}) ? (isInstitutionType(b!.institution_type) ? b!.institution_type as string : undefined) : undefined,
    code: 'code' in (b ?? {}) ? (typeof b!.code === 'string' && CODE.test(b!.code) && b!.code !== 'EQ' ? b!.code : undefined) : undefined,
    has_center: 'has_center' in (b ?? {}) ? (typeof b!.has_center === 'boolean' ? b!.has_center : undefined) : undefined,
    structure_mode: 'structure_mode' in (b ?? {}) ? (b!.structure_mode === 'flat' || b!.structure_mode === 'academic' ? b!.structure_mode as string : undefined) : undefined,
  }
  const sent = Object.entries(f).filter(([, v]) => v !== undefined)
  if (!sent.length || sent.length !== Object.keys(b ?? {}).filter(k => k in f).length) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  // Each column keeps its value unless it was sent: a CASE per column, one statement.
  const on = (k: keyof typeof f) => f[k] !== undefined
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`update public.tenants set
            student_limit = case when ${on('student_limit')} then ${f.student_limit ?? null}::int else student_limit end,
            teacher_limit = case when ${on('teacher_limit')} then ${f.teacher_limit ?? null}::int else teacher_limit end,
            storage_limit_mb = case when ${on('storage_limit_mb')} then ${f.storage_limit_mb ?? null}::int else storage_limit_mb end,
            institution_type = case when ${on('institution_type')} then ${f.institution_type ?? null}::text else institution_type end,
            code = case when ${on('code')} then ${f.code ?? null}::text else code end,
            has_center = case when ${on('has_center')} then ${f.has_center ?? null}::boolean else has_center end,
            structure_mode = case when ${on('structure_mode')} then ${f.structure_mode ?? null}::text else structure_mode end
          where id = ${id} and ${ownerGate(sql, me.id)}
          returning *`,
    ])
    const row = maybeOne(rows)
    return row ? NextResponse.json(row) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === '23505') return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 409 })
    console.error('[super-admin/tenants PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
