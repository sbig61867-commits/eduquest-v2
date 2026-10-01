import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient, staffCan } from '@/lib/staff-auth'
import { sanitizeSearch, searchStudents, type RosterTarget } from '@/lib/data/people'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/roster/candidates?group_id=…|course_id=…&q=…
// The "add a student" selector of RosterModal (/center/groups, /center/courses):
// at most 20 active students of the caller's institution whose NAME matches q,
// minus the target's current members (src/lib/data/people.ts searchStudents,
// nameOnly — id + name, the data those pages sent before; no email).
//
// Who may search = who may add (owner's decision, 2026-10-01): the gate below
// mirrors, step for step, the one the add uses —
//   group  → /api/group-students  resolveGroupOwnership: a teacher (own group
//            only) or staff holding manage_groups, same institution;
//   course → /api/course-enrollments authorize: the course's own teacher, or a
//            non-teacher holding manage_courses, same institution, live course.
// The target lookup uses the service-role client exactly as those routes do;
// the search itself runs on the caller's session, so RLS stays the isolation
// boundary, and the institution always comes from the caller's profile.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const params = new URL(request.url).searchParams
  const groupId = params.get('group_id')
  const courseId = params.get('course_id')
  // Exactly one well-formed target.
  if ((groupId === null) === (courseId === null) || !UUID_RE.test(groupId ?? courseId ?? '')) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  const q = sanitizeSearch(params.get('q'))
  if (!q) return NextResponse.json({ ...(await apiErr('searchQueryRequired')) }, { status: 400 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()

  let target: RosterTarget
  if (groupId) {
    // = /api/group-students resolveGroupOwnership
    const allowed = profile?.role === 'teacher' || (!!profile && staffCan(profile, 'manage_groups'))
    if (!profile?.tenant_id || !allowed) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    const { data: group } = await serviceClient()
      .from('groups').select('id, teacher_id, tenant_id').eq('id', groupId).single()
    if (!group || group.tenant_id !== profile.tenant_id) {
      return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
    }
    if (profile.role === 'teacher' && group.teacher_id !== user.id) {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
    target = { group: groupId }
  } else {
    // = /api/course-enrollments authorize
    if (!profile?.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    const { data: course } = await serviceClient()
      .from('courses').select('id, teacher_id, tenant_id').eq('id', courseId!).is('deleted_at', null).maybeSingle()
    if (!course || course.tenant_id !== profile.tenant_id) {
      return NextResponse.json({ ...(await apiErr('courseNotFound')) }, { status: 404 })
    }
    const staff = profile.role !== 'teacher' && staffCan(profile, 'manage_courses')
    if (course.teacher_id !== user.id && !staff) {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
    target = { course: courseId! }
  }

  const { rows, error } = await searchStudents(supabase, profile.tenant_id, q, target, { nameOnly: true })
  if (error) {
    console.error('[roster/candidates]', error)
    return NextResponse.json({ ...(await apiErr('studentsLoadFailed')) }, { status: 500 })
  }
  return NextResponse.json({ students: rows })
}
