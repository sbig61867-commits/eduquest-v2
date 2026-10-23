import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { staffCan } from '@/lib/staff-auth'
import { sanitizeSearch, studentSearchSql } from '@/lib/data/people'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/roster/candidates?group_id=…|course_id=…&q=…
// The "add a student" selector of RosterModal (/center/groups, /center/courses):
// at most 20 active students of the caller's institution whose NAME matches q,
// minus the target's current members (id + name, the data those pages sent
// before; no email).
//
// Who may search = who may add (owner's decision, 2026-10-01): the gate below
// mirrors, step for step, the one the add uses —
//   group  → /api/group-students: a teacher (own group only) or staff holding
//            manage_groups, same institution;
//   course → /api/course-enrollments: the course's own teacher, or a
//            non-teacher holding manage_courses, same institution, live course.
// One unit, as app_service pinned to the caller's institution: the caller's
// live row, the target, and the search — whose rows are discarded unless the
// gate passes. The institution always comes from the caller's session.
export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const params = new URL(request.url).searchParams
  const groupId = params.get('group_id')
  const courseId = params.get('course_id')
  // Exactly one well-formed target.
  if ((groupId === null) === (courseId === null) || !UUID_RE.test(groupId ?? courseId ?? '')) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  const q = sanitizeSearch(params.get('q'))
  if (!q) return NextResponse.json({ ...(await apiErr('searchQueryRequired')) }, { status: 400 })
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id
  const target = groupId ? { kind: 'group' as const, id: groupId } : { kind: 'course' as const, id: courseId! }

  let me: { role: string; permissions: Record<string, unknown> | null } | null
  let owner: { teacher_id: string } | null
  let students: unknown[]
  try {
    const rows = await run({ as: 'service', tenantId }, sql => [
      sql`select role, permissions from public.users where id = ${ctx.sub} and tenant_id = ${tenantId} and is_active is not false`,
      target.kind === 'group'
        ? sql`select teacher_id from public.groups where id = ${target.id} and tenant_id = ${tenantId}`
        : sql`select teacher_id from public.courses where id = ${target.id} and tenant_id = ${tenantId} and deleted_at is null`,
      studentSearchSql(sql, tenantId, q, target, { nameOnly: true }),
    ])
    me = maybeOne(rows[0])
    owner = maybeOne(rows[1])
    students = rows[2]
  } catch (e) {
    console.error('[roster/candidates]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('studentsLoadFailed')) }, { status: 500 })
  }

  if (target.kind === 'group') {
    const allowed = me?.role === 'teacher' || (!!me && staffCan(me, 'manage_groups'))
    if (!me || !allowed) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if (!owner) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
    if (me.role === 'teacher' && owner.teacher_id !== ctx.sub) {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
  } else {
    if (!me) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    if (!owner) return NextResponse.json({ ...(await apiErr('courseNotFound')) }, { status: 404 })
    const staff = me.role !== 'teacher' && staffCan(me, 'manage_courses')
    if (owner.teacher_id !== ctx.sub && !staff) {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
  }
  return NextResponse.json({ students })
}
