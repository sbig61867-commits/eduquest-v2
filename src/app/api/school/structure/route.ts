import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { authorizeSchool, schoolErr } from '@/lib/school-auth'
import {
  SCHOOL_LIMITS, isStructureKind, isUuid, parseGrade, parseOrder, parseSection, parseStage, parseTerm, parseYear,
  type StructureKind,
} from '@/lib/school-structure'
import {
  archiveItem, createGrade, createSection, createStage, createTerm, createYear, mapWriteError, reorder,
  updateGrade, updateSection, updateStage, updateTerm, updateYear, type WriteResult,
} from '@/lib/data/school-structure'

// /api/school/structure — stages, grades, sections, academic years and terms of
// a SCHOOL (tenants.institution_type = 'school'). Body: { kind, … }.
//   POST    create          PATCH { id, … } edit · { order: [ids] } reorder
//   DELETE  { id } archive (soft: deleted_at; a section → is_active = false)
// The caller is read live (capability manage_academic_structure + the
// institution's type), then the write runs as app_service pinned to the
// caller's institution (src/lib/data/school-structure.ts). The database
// triggers refuse anything cross-tenant or non-school on their own.

type Json = Record<string, unknown>
const err = schoolErr
const authorize = async () => authorizeSchool(await currentCtx(), 'school-structure', 120)

async function readBody(request: Request): Promise<Json | null> {
  try {
    const b = await request.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Json) : null
  } catch { return null }
}

async function answer<T>(kind: StructureKind, work: () => Promise<WriteResult<T>>, okStatus = 200, key: string = kind) {
  try {
    const r = await work()
    if (r.ok) return NextResponse.json({ [key]: r.value }, { status: okStatus })
    return err(r.code, r.status, r.params)
  } catch (e) {
    const mapped = mapWriteError(e, kind)
    if (mapped && !mapped.ok) return err(mapped.code, mapped.status, mapped.params)
    console.error('[api/school/structure]', kind, e instanceof Error ? e.message : e)
    return err(okStatus === 201 ? 'createFailed' : 'updateFailed', 500)
  }
}

export async function POST(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const tenantId = auth.caller.tenant_id
  const body = await readBody(request)
  if (!body || !isStructureKind(body.kind)) return err('invalidData', 400)
  const kind = body.kind

  switch (kind) {
    case 'stage': {
      const p = parseStage(body, 'create')
      if (!p.ok) return err(p.code, 400)
      return answer(kind, () => createStage(tenantId, { ...p.value, kind: p.value.kind!, name: p.value.name! }), 201)
    }
    case 'grade': {
      const p = parseGrade(body, 'create')
      if (!p.ok) return err(p.code, 400)
      return answer(kind, () => createGrade(tenantId, { ...p.value, stage_id: p.value.stage_id!, name: p.value.name! }), 201)
    }
    case 'section': {
      const p = parseSection(body, 'create')
      if (!p.ok) return err(p.code, 400)
      return answer(kind, () => createSection(tenantId, { ...p.value, grade_id: p.value.grade_id!, year_id: p.value.year_id!, label: p.value.label! }), 201)
    }
    case 'year': {
      const p = parseYear(body, 'create')
      if (!p.ok) return err(p.code, 400)
      return answer(kind, () => createYear(tenantId, { ...p.value, name: p.value.name!, starts_on: p.value.starts_on!, ends_on: p.value.ends_on! }), 201)
    }
    case 'term': {
      const p = parseTerm(body, 'create')
      if (!p.ok) return err(p.code, 400)
      const v = p.value
      return answer(kind, () => createTerm(tenantId, { year_id: v.year_id!, term_no: v.term_no!, name: v.name!, starts_on: v.starts_on!, ends_on: v.ends_on! }), 201)
    }
  }
}

export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const tenantId = auth.caller.tenant_id
  const body = await readBody(request)
  if (!body || !isStructureKind(body.kind)) return err('invalidData', 400)
  const kind = body.kind

  // reorder: { kind: stage|grade|section, order: [ids] }
  if (body.order !== undefined) {
    if (kind !== 'stage' && kind !== 'grade' && kind !== 'section') return err('invalidOrder', 400)
    const max = kind === 'stage' ? SCHOOL_LIMITS.stages : kind === 'grade' ? SCHOOL_LIMITS.grades : SCHOOL_LIMITS.sections
    const o = parseOrder(body.order, max)
    if (!o.ok) return err(o.code, 400)
    return answer(kind, () => reorder(tenantId, kind, o.value), 200, 'order')
  }

  if (body.id === undefined) return err('missingId', 400)
  if (!isUuid(body.id)) return err('notFound', 404)
  const id = body.id
  switch (kind) {
    case 'stage': {
      const p = parseStage(body, 'update')
      return p.ok ? answer(kind, () => updateStage(tenantId, id, p.value)) : err(p.code, 400)
    }
    case 'grade': {
      const p = parseGrade(body, 'update')
      return p.ok ? answer(kind, () => updateGrade(tenantId, id, p.value)) : err(p.code, 400)
    }
    case 'section': {
      const p = parseSection(body, 'update')
      return p.ok ? answer(kind, () => updateSection(tenantId, id, p.value)) : err(p.code, 400)
    }
    case 'year': {
      const p = parseYear(body, 'update')
      return p.ok ? answer(kind, () => updateYear(tenantId, id, p.value)) : err(p.code, 400)
    }
    case 'term': {
      const p = parseTerm(body, 'update')
      return p.ok ? answer(kind, () => updateTerm(tenantId, id, p.value)) : err(p.code, 400)
    }
  }
}

export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body || !isStructureKind(body.kind)) return err('invalidData', 400)
  if (body.id === undefined) return err('missingId', 400)
  if (!isUuid(body.id)) return err('notFound', 404)
  const kind = body.kind
  const id = body.id
  try {
    const r = await archiveItem(auth.caller.tenant_id, kind, id)
    return r.ok ? NextResponse.json({ success: true }) : err(r.code, r.status, r.params)
  } catch (e) {
    console.error('[api/school/structure DELETE]', kind, e instanceof Error ? e.message : e)
    return err('archiveFailed', 500)
  }
}
