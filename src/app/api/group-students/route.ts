import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { staffCan } from '@/lib/staff-auth'
import { readRosterPage, rosterPageParam } from '@/lib/data/rosters'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROSTER_LIMIT = 5000

type Group = { id: string; teacher_id: string; tenant_id: string; max_students: number | null; course_id: string | null }

// Shared: the caller (live) and the group in one unit, as app_service pinned to
// the session's institution. Teachers (own groups) · staff holding
// manage_groups — the flag binds a university_admin too, not only a centre manager.
async function resolveGroupOwnership(groupId: string) {
  const ctx = await currentCtx()
  if (!ctx) return { response: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  if (!ctx.tenant_id) return { response: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  const tenantId = ctx.tenant_id
  const [me, groups] = await run({ as: 'service', tenantId }, sql => [
    sql`select role, permissions from public.users where id = ${ctx.sub} and tenant_id = ${tenantId} and is_active is not false`,
    sql`select id, teacher_id, tenant_id, max_students, course_id from public.groups
         where id = ${UUID.test(groupId) ? groupId : null}::uuid and tenant_id = ${tenantId}`,
  ])
  const profile = maybeOne<{ role: string; permissions: Record<string, unknown> | null }>(me)
  const allowed = profile?.role === 'teacher' || (!!profile && staffCan(profile, 'manage_groups'))
  if (!profile || !allowed) return { response: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  const group = maybeOne<Group>(groups)
  if (!group) return { response: NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 }) }
  if (profile.role === 'teacher' && group.teacher_id !== ctx.sub) {
    return { response: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  return { userId: ctx.sub, tenantId, role: profile.role, group }
}

// GET /api/group-students?group_id=xxx
// Returns the list of students enrolled in a group
export async function GET(request: Request) {
  const groupId = new URL(request.url).searchParams.get('group_id')
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!groupId) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })

  const auth = await resolveGroupOwnership(groupId)
  if ('response' in auth) return auth.response

  try {
    // RosterModal asks for one page (?page=); without it the whole roster comes
    // back (/teacher/groups reads it whole).
    const page = rosterPageParam(new URL(request.url).searchParams)
    if (page !== null) return NextResponse.json(await readRosterPage(auth.tenantId, 'group', groupId, page))

    const [rows] = await run({ as: 'service', tenantId: auth.tenantId }, sql => [
      sql`select u.id, u.full_name, u.email
            from public.group_students gs join public.users u on u.id = gs.student_id
           where gs.group_id = ${groupId}
           limit ${ROSTER_LIMIT}`,
    ])
    return NextResponse.json({ students: rows })
  } catch (e) {
    console.error('[group-students GET]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('studentsLoadFailed')) }, { status: 500 })
  }
}

// POST /api/group-students — enroll a student
// Body: { group_id, student_id }
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { group_id?: string; student_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { group_id, student_id } = body
  if (!group_id || !student_id) {
    return NextResponse.json({ ...(await apiErr('missingGroupOrStudent')) }, { status: 400 })
  }

  const auth = await resolveGroupOwnership(group_id)
  if ('response' in auth) return auth.response
  const { group, tenantId, userId, role } = auth
  if (!UUID.test(student_id)) return NextResponse.json({ ...(await apiErr('studentNotInTenant')) }, { status: 404 })

  // One unit:
  //  1. the student (must be a student of this institution) and whether a seat
  //     is left (max_students NULL = no cap; already a member = room)
  //  2. the membership, written ONLY when both hold and the caller is still
  //     live with the role checked above (and, for a teacher, still the owner)
  //  3. a group that is a section of a course also enrols its students there
  //     (the reverse never happens: joining a course adds no group)
  try {
    const rows = await run({ as: 'service', tenantId }, sql => [
      sql`select u.id, u.full_name, u.email,
                 (${group.max_students}::int is null
                  or exists (select 1 from public.group_students where group_id = ${group.id} and student_id = u.id)
                  or (select count(*) from public.group_students where group_id = ${group.id}) < ${group.max_students}::int) as has_room
            from public.users u where u.id = ${student_id} and u.tenant_id = ${tenantId} and u.role = 'student'`,
      sql`insert into public.group_students (group_id, student_id)
          select g.id, u.id from public.groups g, public.users u
           where g.id = ${group.id} and g.tenant_id = ${tenantId}
             and u.id = ${student_id} and u.tenant_id = ${tenantId} and u.role = 'student'
             and (g.max_students is null
                  or exists (select 1 from public.group_students where group_id = g.id and student_id = u.id)
                  or (select count(*) from public.group_students where group_id = g.id) < g.max_students)
             and exists (select 1 from public.users where id = ${userId} and tenant_id = ${tenantId} and is_active is not false and role = ${role})
             and (${role} <> 'teacher' or g.teacher_id = ${userId})
          on conflict (group_id, student_id) do nothing`,
      ...(group.course_id ? [
        sql`insert into public.course_enrollments (course_id, student_id, tenant_id)
            select ${group.course_id}, gs.student_id, ${tenantId} from public.group_students gs
             where gs.group_id = ${group.id} and gs.student_id = ${student_id}
            on conflict (course_id, student_id) do nothing`,
      ] : []),
    ])
    const student = maybeOne<{ id: string; full_name: string; email: string; has_room: boolean }>(rows[0])
    if (!student) return NextResponse.json({ ...(await apiErr('studentNotInTenant')) }, { status: 404 })
    if (!student.has_room) {
      return NextResponse.json({ ...(await apiErr('groupFull', { max: group.max_students ?? 0 })) }, { status: 409 })
    }
    return NextResponse.json({ student: { id: student.id, full_name: student.full_name, email: student.email } }, { status: 201 })
  } catch (e) {
    console.error('[group-students POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('enrollFailed')) }, { status: 500 })
  }
}

// DELETE /api/group-students — remove a student
// Body: { group_id, student_id }
export async function DELETE(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { group_id?: string; student_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { group_id, student_id } = body
  if (!group_id || !student_id) {
    return NextResponse.json({ ...(await apiErr('missingGroupOrStudent')) }, { status: 400 })
  }

  const auth = await resolveGroupOwnership(group_id)
  if ('response' in auth) return auth.response
  if (!UUID.test(student_id)) return NextResponse.json({ ok: true })

  try {
    await run({ as: 'service', tenantId: auth.tenantId }, sql => [
      sql`delete from public.group_students gs
           where gs.group_id = ${auth.group.id} and gs.student_id = ${student_id}
             and exists (select 1 from public.users where id = ${auth.userId} and tenant_id = ${auth.tenantId}
                           and is_active is not false and role = ${auth.role})`,
    ])
  } catch (e) {
    console.error('[group-students DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('studentRemoveFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
