import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { authorizeSchool, schoolErr as err } from '@/lib/school-auth'
import { isUuid, parsePlacement } from '@/lib/school-structure'
import { listPlacementStudents, mapWriteError, placeStudents, unplaceStudents } from '@/lib/data/school-structure'

// /api/school/placement — التسكين: students of a school ↔ its sections, per
// academic year (one section per student per year, enforced by the database).
//   GET    ?year_id=&q=&page=&unplaced=1&section_id=   one page of 50 students
//          with each one's section in that year (read as the caller, RLS)
//   POST   { section_id, student_ids ≤ 100 }   place (moves from another section
//          of the same year), capacity-checked under a row lock
//   DELETE { section_id, student_ids ≤ 100 }   remove from that section
// Same gate as /api/school/structure; writes as app_service pinned to the school.

export async function GET(request: Request) {
  const auth = await authorizeSchool(await currentCtx(), 'school-placement-read', 240)
  if ('response' in auth) return auth.response
  const { caller } = auth
  const params = new URL(request.url).searchParams
  const yearId = params.get('year_id')
  if (!isUuid(yearId)) return err('yearNotFound', 404)
  try {
    const page = await listPlacementStudents(caller.id, caller.tenant_id, {
      yearId, q: params.get('q'), page: params.get('page'),
      unplaced: params.get('unplaced') === '1', sectionId: params.get('section_id'),
    })
    return page ? NextResponse.json(page) : err('yearNotFound', 404)
  } catch (e) {
    console.error('[api/school/placement GET]', e instanceof Error ? e.message : e)
    return err('studentsLoadFailed', 500)
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null
  } catch { return null }
}

export async function POST(request: Request) {
  const auth = await authorizeSchool(await currentCtx(), 'school-placement', 60)
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body) return err('invalidData', 400)
  const p = parsePlacement(body)
  if (!p.ok) return err(p.code, 400)
  try {
    const r = await placeStudents(auth.caller.tenant_id, p.value)
    return r.ok ? NextResponse.json(r.value, { status: 201 }) : err(r.code, r.status, r.params)
  } catch (e) {
    const mapped = mapWriteError(e, 'section')
    if (mapped && !mapped.ok) return err(mapped.code, mapped.status, mapped.params)
    console.error('[api/school/placement POST]', e instanceof Error ? e.message : e)
    return err('enrollFailed', 500)
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeSchool(await currentCtx(), 'school-placement', 60)
  if ('response' in auth) return auth.response
  const body = await readBody(request)
  if (!body) return err('invalidData', 400)
  const p = parsePlacement(body)
  if (!p.ok) return err(p.code, 400)
  try {
    const r = await unplaceStudents(auth.caller.tenant_id, p.value)
    return r.ok ? NextResponse.json(r.value) : err(r.code, r.status, r.params)
  } catch (e) {
    console.error('[api/school/placement DELETE]', e instanceof Error ? e.message : e)
    return err('studentRemoveFailed', 500)
  }
}
