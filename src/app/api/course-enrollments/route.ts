import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { staffCan } from '@/lib/staff-auth'
import { readRosterPage, rosterPageParam } from '@/lib/data/rosters'

// Enrol / unenrol students in a structured course. Allowed for the course's
// own teacher, or staff holding manage_courses in the same tenant. The caller
// (live) and the course are read in one unit; the write runs as app_service
// pinned to the institution and repeats the live check.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROSTER_LIMIT = 5000

async function authorize(courseId: string) {
  const ctx = await currentCtx()
  if (!ctx) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  if (!ctx.tenant_id) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  const tenantId = ctx.tenant_id

  const [me, courses] = await run({ as: 'service', tenantId }, sql => [
    sql`select role, permissions from public.users where id = ${ctx.sub} and tenant_id = ${tenantId} and is_active is not false`,
    sql`select teacher_id from public.courses
         where id = ${UUID.test(courseId) ? courseId : null}::uuid and tenant_id = ${tenantId} and deleted_at is null`,
  ])
  const profile = maybeOne<{ role: string; permissions: Record<string, unknown> | null }>(me)
  if (!profile) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  const course = maybeOne<{ teacher_id: string }>(courses)
  if (!course) return { error: NextResponse.json({ ...(await apiErr('courseNotFound')) }, { status: 404 }) }
  const staff = profile.role !== 'teacher' && staffCan(profile, 'manage_courses')
  if (course.teacher_id !== ctx.sub && !staff) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  return { userId: ctx.sub, tenantId, role: profile.role, staff }
}

// GET /api/course-enrollments?course_id=…
export async function GET(request: Request) {
  const courseId = new URL(request.url).searchParams.get('course_id')
  if (!courseId) return NextResponse.json({ ...(await apiErr('missingCourseId')) }, { status: 400 })
  const auth = await authorize(courseId)
  if ('error' in auth) return auth.error

  try {
    // RosterModal asks for one page (?page=); without it the whole list comes back.
    const page = rosterPageParam(new URL(request.url).searchParams)
    if (page !== null) return NextResponse.json(await readRosterPage(auth.tenantId, 'course', courseId, page))

    const [rows] = await run({ as: 'service', tenantId: auth.tenantId }, sql => [
      sql`select u.id, u.full_name, u.email
            from public.course_enrollments e join public.users u on u.id = e.student_id
           where e.course_id = ${courseId}
           order by e.enrolled_at desc
           limit ${ROSTER_LIMIT}`,
    ])
    return NextResponse.json({ students: rows })
  } catch (e) {
    console.error('[course-enrollments GET]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('enrollmentsLoadFailed')) }, { status: 500 })
  }
}

// POST /api/course-enrollments { course_id, student_id }
export async function POST(request: Request) {
  let body: { course_id?: string; student_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const { course_id, student_id } = body
  if (!course_id || !student_id) return NextResponse.json({ ...(await apiErr('missingCourseOrStudent')) }, { status: 400 })

  const auth = await authorize(course_id)
  if ('error' in auth) return auth.error
  const a = auth
  if (!UUID.test(student_id)) return NextResponse.json({ ...(await apiErr('studentNotInTenant')) }, { status: 404 })

  // One unit: the student (a student of this institution), then the enrolment
  // — written only while the caller is still allowed. Enrolment does not
  // consume a plan seat — the seat is the account itself, already capped in
  // create-user / accept-invitation.
  try {
    const [studentRows] = await run({ as: 'service', tenantId: a.tenantId }, sql => [
      sql`select id, full_name, email from public.users where id = ${student_id} and tenant_id = ${a.tenantId} and role = 'student'`,
      sql`insert into public.course_enrollments (course_id, student_id, tenant_id)
          select c.id, u.id, ${a.tenantId} from public.courses c, public.users u
           where c.id = ${course_id} and c.tenant_id = ${a.tenantId} and c.deleted_at is null
             and u.id = ${student_id} and u.tenant_id = ${a.tenantId} and u.role = 'student'
             and exists (select 1 from public.users where id = ${a.userId} and tenant_id = ${a.tenantId} and is_active is not false and role = ${a.role})
             and (${a.staff} or c.teacher_id = ${a.userId})
          on conflict (course_id, student_id) do nothing`,
    ])
    const student = maybeOne<{ id: string; full_name: string; email: string }>(studentRows)
    if (!student) return NextResponse.json({ ...(await apiErr('studentNotInTenant')) }, { status: 404 })
    return NextResponse.json({ student }, { status: 201 })
  } catch (e) {
    console.error('[course-enrollments POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('enrollFailed')) }, { status: 500 })
  }
}

// DELETE /api/course-enrollments { course_id, student_id }
export async function DELETE(request: Request) {
  let body: { course_id?: string; student_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const { course_id, student_id } = body
  if (!course_id || !student_id) return NextResponse.json({ ...(await apiErr('missingCourseOrStudent')) }, { status: 400 })

  const auth = await authorize(course_id)
  if ('error' in auth) return auth.error
  const a = auth
  if (!UUID.test(student_id)) return NextResponse.json({ ok: true })

  try {
    await run({ as: 'service', tenantId: a.tenantId }, sql => [
      sql`delete from public.course_enrollments e
           where e.course_id = ${course_id} and e.student_id = ${student_id} and e.tenant_id = ${a.tenantId}
             and exists (select 1 from public.users where id = ${a.userId} and tenant_id = ${a.tenantId} and is_active is not false and role = ${a.role})`,
    ])
  } catch (e) {
    console.error('[course-enrollments DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unenrollFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
