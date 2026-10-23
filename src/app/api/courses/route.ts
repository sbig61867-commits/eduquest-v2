import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row, type Sql } from '@/lib/db/sql'
import { staffCan } from '@/lib/staff-auth'
import { deleteEntityAs } from '@/lib/delete-entity'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Profile = {
  role: string
  tenant_id: string
  can_create_courses: boolean | null
  permissions: Record<string, unknown> | null
}

/** Staff (admin / centre manager with manage_courses) manage every course in their tenant. */
function isCourseStaff(profile: Profile) {
  return profile.role !== 'teacher' && staffCan(profile, 'manage_courses')
}

/** The level and enrolment counts the UI lists a course with (columns of row `c`). */
const counts = (sql: Sql) => sql`
  json_build_array(json_build_object('count', (select count(*) from public.course_levels l where l.course_id = c.id))) as course_levels,
  json_build_array(json_build_object('count', (select count(*) from public.course_enrollments e where e.course_id = c.id))) as course_enrollments`

/**
 * One unit, as app_service pinned to the session's institution: the caller's
 * LIVE row (role, capabilities, active), and on request a course and a
 * would-be teacher — both only if they are in this institution.
 */
async function loadCourseCaller(opts: { courseId?: string; teacherId?: string } = {}) {
  const ctx = await currentCtx()
  if (!ctx) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  if (!ctx.tenant_id) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  const tenantId = ctx.tenant_id
  const rows = await run({ as: 'service', tenantId }, sql => [
    sql`select role, tenant_id, can_create_courses, permissions from public.users
         where id = ${ctx.sub} and tenant_id = ${tenantId} and is_active is not false`,
    ...(opts.courseId ? [sql`select teacher_id from public.courses where id = ${opts.courseId} and tenant_id = ${tenantId}`] : []),
    ...(opts.teacherId ? [sql`select id from public.users where id = ${opts.teacherId} and tenant_id = ${tenantId} and role = 'teacher'`] : []),
  ])
  const profile = maybeOne<Profile>(rows[0])
  if (!profile) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  let i = 1
  const course = opts.courseId ? maybeOne<{ teacher_id: string }>(rows[i++]) : null
  const teacherOk = opts.teacherId ? !!maybeOne(rows[i]) : false
  return { userId: ctx.sub, tenantId, profile, course, teacherOk }
}

/** The caller is still live in this institution with the role the rules were applied to (repeated inside each write). */
const liveCaller = (sql: Sql, userId: string, tenantId: string, role: string) =>
  sql`exists (select 1 from public.users where id = ${userId} and tenant_id = ${tenantId} and is_active is not false and role = ${role})`

// POST /api/courses — create course
export async function POST(request: Request) {
  let body: { title?: string; description?: string; language?: string; has_levels?: boolean; teacher_id?: string }
  try { body = await request.json() }
  catch { body = {} }

  const requestedTeacher = typeof body.teacher_id === 'string' && UUID.test(body.teacher_id) ? body.teacher_id : undefined
  const auth = await loadCourseCaller({ teacherId: requestedTeacher })
  if (auth.error) return auth.error
  const { userId, tenantId, profile } = auth

  const staff = isCourseStaff(profile)
  const teacherSelf = profile.role === 'teacher' && profile.can_create_courses === true
  if (!staff && !teacherSelf) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  if (!Object.keys(body).length) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })

  const { title, description, language, has_levels } = body
  if (!title?.trim()) return NextResponse.json({ ...(await apiErr('titleRequired')) }, { status: 400 })

  // A teacher owns what they create; staff must hand the course to a real
  // teacher in the tenant, who then builds its levels/units/content.
  let teacherId = userId
  if (staff) {
    if (!requestedTeacher || !auth.teacherOk) {
      return NextResponse.json({ ...(await apiErr('chooseCourseTeacher')) }, { status: 400 })
    }
    teacherId = requestedTeacher
  }

  try {
    const [rows] = await run({ as: 'service', tenantId }, sql => [
      sql`with ins as (
            insert into public.courses (title, description, language, has_levels, teacher_id, tenant_id)
            select ${title.trim()}, ${description || null}, ${language || null}, ${has_levels ?? true}, ${teacherId}, ${tenantId}
             where ${liveCaller(sql, userId, tenantId, profile.role)}
               and exists (select 1 from public.users where id = ${teacherId} and tenant_id = ${tenantId} and role = 'teacher')
            returning *
          ) select c.*, ${counts(sql)} from ins c`,
    ])
    const created = maybeOne<Row>(rows)
    if (!created) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('[api/courses POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('courseCreateFailed')) }, { status: 500 })
  }
}

/** Owner teacher, or course staff in the same tenant. */
function mayManage(auth: { userId: string; profile: Profile; course: { teacher_id: string } | null }) {
  return !!auth.course && (auth.course.teacher_id === auth.userId || isCourseStaff(auth.profile))
}

// PATCH /api/courses — update course (publish toggle, rename, reassign teacher)
export async function PATCH(request: Request) {
  let body: { id?: string; is_published?: boolean; title?: string; teacher_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, ...rest } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const newTeacher = typeof rest.teacher_id === 'string' && UUID.test(rest.teacher_id) ? rest.teacher_id : undefined
  const auth = await loadCourseCaller({ courseId: id, teacherId: newTeacher })
  if (auth.error) return auth.error
  if (!mayManage(auth)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const { userId, tenantId, profile } = auth

  let title: string | null = null
  if (rest.title !== undefined) {
    if (!String(rest.title).trim()) return NextResponse.json({ ...(await apiErr('titleRequired')) }, { status: 400 })
    title = String(rest.title).trim()
  }
  if (rest.teacher_id !== undefined) {
    if (!isCourseStaff(profile)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if (!newTeacher || !auth.teacherOk) return NextResponse.json({ ...(await apiErr('teacherNotInTenant')) }, { status: 400 })
  }
  const published = rest.is_published !== undefined ? rest.is_published === true : null
  if (title === null && published === null && rest.teacher_id === undefined) {
    return NextResponse.json({ ...(await apiErr('nothingToUpdate')) }, { status: 400 })
  }

  // The write repeats what was checked: the caller is still live with the
  // same role, and — for a teacher — still the course's owner.
  const ownerOnly = !isCourseStaff(profile)
  try {
    const [rows] = await run({ as: 'service', tenantId }, sql => [
      sql`with upd as (
            update public.courses c set
              is_published = coalesce(${published}::boolean, c.is_published),
              title = coalesce(${title}::text, c.title),
              teacher_id = coalesce(${newTeacher ?? null}::uuid, c.teacher_id)
             where c.id = ${id} and c.tenant_id = ${tenantId}
               and ${liveCaller(sql, userId, tenantId, profile.role)}
               and (not ${ownerOnly} or c.teacher_id = ${userId})
            returning c.*
          ) select c.*, ${counts(sql)} from upd c`,
    ])
    const updated = maybeOne<Row>(rows)
    if (!updated) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[api/courses PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('courseUpdateFailed')) }, { status: 500 })
  }
}

// DELETE /api/courses — delete course
export async function DELETE(request: Request) {
  let body: { id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const auth = await loadCourseCaller({ courseId: id })
  if (auth.error) return auth.error
  if (!mayManage(auth)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  // Archive by default; hard delete only when the owner enabled it — same
  // policy as groups/lessons/exams, so a deleted course stays restorable.
  const { error, mode } = await deleteEntityAs(auth.userId, auth.tenantId, 'course', id)
  if (error) {
    console.error('[api/courses DELETE]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ...(await apiErr('courseDeleteFailed')) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, mode })
}
