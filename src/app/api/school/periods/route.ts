import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { authorizeSchool, schoolErr as err } from '@/lib/school-auth'
import { isUuid } from '@/lib/school-structure'
import { parsePeriod } from '@/lib/school-timetable'
import { archivePeriod, createPeriod, mapTimetableError, updatePeriod, type WriteResult } from '@/lib/data/school-timetable'

// /api/school/periods — الحصص: the bell schedule of a SCHOOL (lessons and
// breaks with times; shift NULL = every shift, else morning / evening).
//   POST   { period_kind: lesson|break, shift?, name?, starts_at: 'HH:MM', ends_at }   create
//   PATCH  { id, …same fields }                                                       edit
//   DELETE { id }                                    archive (soft; refused while a timetable uses it)
// Periods of one shift never overlap (database). A time change is copied into
// every current timetable cell of the period, and refused if it would put a
// teacher in two places at once. Gate: manage_academic_structure, schools only.

type Json = Record<string, unknown>
const authorize = async () => authorizeSchool(await currentCtx(), 'school-periods', 120)

async function readBody(request: Request): Promise<Json | null> {
  try {
    const b = await request.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Json) : null
  } catch { return null }
}

async function answer<T>(work: () => Promise<WriteResult<T>>, okStatus = 200) {
  try {
    const r = await work()
    if (r.ok) return NextResponse.json({ period: r.value }, { status: okStatus })
    return err(r.code, r.status, r.params)
  } catch (e) {
    const mapped = mapTimetableError(e)
    if (mapped && !mapped.ok) return err(mapped.code, mapped.status, mapped.params)
    console.error('[api/school/periods]', e instanceof Error ? e.message : e)
    return err(okStatus === 201 ? 'createFailed' : 'updateFailed', 500)
  }
}

export async function POST(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body) return err('invalidData', 400)
  const p = parsePeriod(body, 'create')
  if (!p.ok) return err(p.code, 400)
  const v = p.value
  return answer(() => createPeriod(auth.caller.tenant_id, { ...v, kind: v.kind!, starts_at: v.starts_at!, ends_at: v.ends_at! }), 201)
}

export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body) return err('invalidData', 400)
  if (body.id === undefined) return err('missingId', 400)
  if (!isUuid(body.id)) return err('periodNotFound', 404)
  const id = body.id
  const p = parsePeriod(body, 'update')
  if (!p.ok) return err(p.code, 400)
  return answer(() => updatePeriod(auth.caller.tenant_id, id, p.value))
}

export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body) return err('invalidData', 400)
  if (body.id === undefined) return err('missingId', 400)
  if (!isUuid(body.id)) return err('periodNotFound', 404)
  const id = body.id
  try {
    const r = await archivePeriod(auth.caller.tenant_id, id)
    return r.ok ? NextResponse.json({ success: true }) : err(r.code, r.status, r.params)
  } catch (e) {
    const mapped = mapTimetableError(e)
    if (mapped && !mapped.ok) return err(mapped.code, mapped.status, mapped.params)
    console.error('[api/school/periods DELETE]', e instanceof Error ? e.message : e)
    return err('archiveFailed', 500)
  }
}
