import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { authorizeSchool, schoolErr as err } from '@/lib/school-auth'
import { isUuid } from '@/lib/school-structure'
import { parseCell, parseSubjectTeacher } from '@/lib/school-timetable'
import {
  clearCell, loadSectionTimetable, mapTimetableError, publishTimetable, setCell, setSubjectTeacher, type WriteResult,
} from '@/lib/data/school-timetable'

// /api/school/timetable — جدول الحصص of one section of a SCHOOL. The section's
// timetable is its group timetable (public.schedules, one per group) and each
// cell a schedule_slots row (day × period), so students and teachers see it on
// their existing schedule screens once it is published.
//   GET    ?section_id=        the section, its cells, its subject teachers and
//                              those teachers' periods elsewhere (read as the caller, RLS)
//   POST   { kind: 'cell', section_id, day 0–6, period_id, subject_id }      set a cell
//          { kind: 'teacher', section_id, subject_id, teacher_id | null }    the subject's teacher
//   PATCH  { section_id, is_published }                                     publish to students
//   DELETE { kind: 'cell', section_id, day, period_id }                     clear a cell
// Gate: manage_schedules (the capability of every timetable write), schools
// only, rate-limited per user; writes as app_service pinned to the school. The
// database refuses a subject outside the section's grade, a break, another
// shift's period and a teacher in two sections at the same time.

type Json = Record<string, unknown>
const authorize = async (feature: string, limit: number) =>
  authorizeSchool(await currentCtx(), feature, limit, 'manage_schedules')

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
    console.error('[api/school/timetable]', key, e instanceof Error ? e.message : e)
    return err('scheduleUpdateFailed', 500)
  }
}

export async function GET(request: Request) {
  const auth = await authorize('school-timetable-read', 240)
  if ('response' in auth) return auth.response
  const sectionId = new URL(request.url).searchParams.get('section_id')
  if (!isUuid(sectionId)) return err('sectionNotFound', 404)
  try {
    const timetable = await loadSectionTimetable(auth.caller.id, auth.caller.tenant_id, sectionId)
    return timetable ? NextResponse.json(timetable) : err('sectionNotFound', 404)
  } catch (e) {
    console.error('[api/school/timetable GET]', e instanceof Error ? e.message : e)
    return err('scheduleLoadFailed', 500)
  }
}

export async function POST(request: Request) {
  const auth = await authorize('school-timetable', 240)
  if ('response' in auth) return auth.response
  const { caller } = auth
  const body = await readBody(request)
  if (!body) return err('invalidData', 400)
  if (body.kind === 'cell') {
    const p = parseCell(body, false)
    if (!p.ok) return err(p.code, 400)
    return answer('cell', () => setCell(caller.tenant_id, caller.id, { ...p.value, subject_id: p.value.subject_id! }))
  }
  if (body.kind === 'teacher') {
    const p = parseSubjectTeacher(body)
    if (!p.ok) return err(p.code, 400)
    return answer('teacher', () => setSubjectTeacher(caller.tenant_id, p.value))
  }
  return err('invalidData', 400)
}

export async function PATCH(request: Request) {
  const auth = await authorize('school-timetable', 240)
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body || typeof body.is_published !== 'boolean') return err('invalidData', 400)
  if (!isUuid(body.section_id)) return err('sectionNotFound', 404)
  const sectionId = body.section_id
  const published = body.is_published
  return answer('schedule', () => publishTimetable(auth.caller.tenant_id, auth.caller.id, sectionId, published))
}

export async function DELETE(request: Request) {
  const auth = await authorize('school-timetable', 240)
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body || body.kind !== 'cell') return err('invalidData', 400)
  const p = parseCell(body, true)
  if (!p.ok) return err(p.code, 400)
  return answer('cell', () => clearCell(auth.caller.tenant_id, p.value))
}
