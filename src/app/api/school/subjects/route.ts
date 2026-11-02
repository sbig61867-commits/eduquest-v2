import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { authorizeSchool, schoolErr as err } from '@/lib/school-auth'
import { isUuid } from '@/lib/school-structure'
import { isCurriculumKind, parseGradeSubject, parseSubject } from '@/lib/school-timetable'
import {
  archiveSubject, createSubject, mapTimetableError, setGradeSubject, updateSubject, type WriteResult,
} from '@/lib/data/school-timetable'

// /api/school/subjects — المواد الدراسية of a SCHOOL and the grades they are taught in.
//   POST   { kind: 'subject', name, code, colour? }                 create
//          { kind: 'gradeSubject', grade_id, subject_id, weekly_sessions }
//                                  link (upsert); weekly_sessions 0 = stop teaching it in that grade
//   PATCH  { kind: 'subject', id, name?, code?, colour? }           edit
//   DELETE { kind: 'subject', id }                                   archive (soft; refused while a timetable uses it)
// Same gate as /api/school/structure (manage_academic_structure, schools only,
// rate-limited); writes as app_service pinned to the caller's school.

type Json = Record<string, unknown>
const authorize = async () => authorizeSchool(await currentCtx(), 'school-subjects', 120)

async function readBody(request: Request): Promise<Json | null> {
  try {
    const b = await request.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Json) : null
  } catch { return null }
}

async function answer<T>(key: string, work: () => Promise<WriteResult<T>>, okStatus = 200) {
  try {
    const r = await work()
    if (r.ok) return NextResponse.json({ [key]: r.value }, { status: okStatus })
    return err(r.code, r.status, r.params)
  } catch (e) {
    const mapped = mapTimetableError(e)
    if (mapped && !mapped.ok) return err(mapped.code, mapped.status, mapped.params)
    console.error('[api/school/subjects]', key, e instanceof Error ? e.message : e)
    return err(okStatus === 201 ? 'createFailed' : 'updateFailed', 500)
  }
}

export async function POST(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const tenantId = auth.caller.tenant_id
  const body = await readBody(request)
  if (!body || !isCurriculumKind(body.kind)) return err('invalidData', 400)
  if (body.kind === 'subject') {
    const p = parseSubject(body, 'create')
    if (!p.ok) return err(p.code, 400)
    return answer('subject', () => createSubject(tenantId, { ...p.value, name: p.value.name!, code: p.value.code! }), 201)
  }
  const p = parseGradeSubject(body)
  if (!p.ok) return err(p.code, 400)
  return answer('gradeSubject', () => setGradeSubject(tenantId, p.value))
}

export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body || body.kind !== 'subject') return err('invalidData', 400)
  if (body.id === undefined) return err('missingId', 400)
  if (!isUuid(body.id)) return err('subjectNotFound', 404)
  const id = body.id
  const p = parseSubject(body, 'update')
  if (!p.ok) return err(p.code, 400)
  return answer('subject', () => updateSubject(auth.caller.tenant_id, id, p.value))
}

export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body || body.kind !== 'subject') return err('invalidData', 400)
  if (body.id === undefined) return err('missingId', 400)
  if (!isUuid(body.id)) return err('subjectNotFound', 404)
  const id = body.id
  try {
    const r = await archiveSubject(auth.caller.tenant_id, id)
    return r.ok ? NextResponse.json({ success: true }) : err(r.code, r.status, r.params)
  } catch (e) {
    console.error('[api/school/subjects DELETE]', e instanceof Error ? e.message : e)
    return err('archiveFailed', 500)
  }
}
