import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { staffCan } from '@/lib/staff-auth'
import { enrolStudentInGroup, groupHasRoom, type EnrolmentGroup } from '@/lib/group-enrolment'
import { readRosterPage, rosterPageParam } from '@/lib/data/rosters'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Shared: verify caller is a teacher who owns the group (or admin in same tenant)
async function resolveGroupOwnership(userId: string, groupId: string) {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, tenant_id, permissions')
    .eq('id', userId)
    .single()

  // Teachers (own groups, checked below) · staff holding manage_groups — the
  // flag binds a university_admin too, not only a centre manager.
  const allowed = profile?.role === 'teacher' || (!!profile && staffCan(profile, 'manage_groups'))
  if (!profile?.tenant_id || !allowed) {
    return { ...(await apiErr('forbidden')), status: 403, profile: null, group: null }
  }

  const { data: group } = await adminClient()
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single()

  if (!group || group.tenant_id !== profile.tenant_id) {
    return { ...(await apiErr('groupNotFound')), status: 404, profile: null, group: null }
  }

  if (profile.role === 'teacher' && group.teacher_id !== userId) {
    return { ...(await apiErr('forbidden')), status: 403, profile: null, group: null }
  }

  return { error: null, status: 200, profile, group }
}

// GET /api/group-students?group_id=xxx
// Returns the list of students enrolled in a group
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const groupId = new URL(request.url).searchParams.get('group_id')
  if (!groupId) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })

  const { error, status } = await resolveGroupOwnership(user.id, groupId)
  if (error) return NextResponse.json({ error }, { status })

  // RosterModal asks for one page (?page=); without it the whole roster comes
  // back exactly as before (/teacher/groups reads it whole).
  const page = rosterPageParam(new URL(request.url).searchParams)
  if (page !== null) {
    const { data, error: pageErr } = await readRosterPage(adminClient(), 'group', groupId, page)
    if (pageErr) {
      console.error('[group-students GET page]', pageErr)
      return NextResponse.json({ ...(await apiErr('studentsLoadFailed')) }, { status: 500 })
    }
    return NextResponse.json(data)
  }

  const { data, error: dbErr } = await adminClient()
    .from('group_students')
    .select('student_id, users!group_students_student_id_fkey(id, full_name, email)')
    .eq('group_id', groupId)

  if (dbErr) {
    console.error('[group-students GET]', dbErr)
    return NextResponse.json({ ...(await apiErr('studentsLoadFailed')) }, { status: 500 })
  }

  type UserItem = { id: string; full_name: string; email: string }
  type Row = { student_id: string; users: UserItem | UserItem[] | null }
  const students = (data ?? [] as Row[]).map((r: Row) => Array.isArray(r.users) ? r.users[0] : r.users).filter(Boolean)
  return NextResponse.json({ students })
}

// POST /api/group-students — enroll a student
// Body: { group_id, student_id }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { group_id?: string; student_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { group_id, student_id } = body
  if (!group_id || !student_id) {
    return NextResponse.json({ ...(await apiErr('missingGroupOrStudent')) }, { status: 400 })
  }

  const { error, status, group } = await resolveGroupOwnership(user.id, group_id)
  if (error || !group) return NextResponse.json({ error }, { status })

  // Verify the student belongs to the same tenant
  const { data: student } = await adminClient()
    .from('users')
    .select('id, full_name, email, role, tenant_id')
    .eq('id', student_id)
    .eq('role', 'student')
    .single()

  if (!student || student.tenant_id !== group.tenant_id) {
    return NextResponse.json({ ...(await apiErr('studentNotInTenant')) }, { status: 404 })
  }

  // Group rule: seat cap (max_students NULL = no cap; column absent pre-migration).
  const admin = adminClient()
  const target = group as EnrolmentGroup
  if (!(await groupHasRoom(admin, target, student_id))) {
    return NextResponse.json({ ...(await apiErr('groupFull', { max: target.max_students ?? 0 })) }, { status: 409 })
  }

  const { error: dbErr } = await enrolStudentInGroup(admin, target, student_id)
  if (dbErr) {
    console.error('[group-students POST]', dbErr)
    return NextResponse.json({ ...(await apiErr('enrollFailed')) }, { status: 500 })
  }

  return NextResponse.json({ student: { id: student.id, full_name: student.full_name, email: student.email } }, { status: 201 })
}

// DELETE /api/group-students — remove a student
// Body: { group_id, student_id }
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { group_id?: string; student_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { group_id, student_id } = body
  if (!group_id || !student_id) {
    return NextResponse.json({ ...(await apiErr('missingGroupOrStudent')) }, { status: 400 })
  }

  const { error, status } = await resolveGroupOwnership(user.id, group_id)
  if (error) return NextResponse.json({ error }, { status })

  const { error: dbErr } = await adminClient()
    .from('group_students')
    .delete()
    .eq('group_id', group_id)
    .eq('student_id', student_id)

  if (dbErr) {
    console.error('[group-students DELETE]', dbErr)
    return NextResponse.json({ ...(await apiErr('studentRemoveFailed')) }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
