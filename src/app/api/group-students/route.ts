import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { staffCan } from '@/lib/staff-auth'

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

  const managerAllowed = profile?.role === 'center_manager' && staffCan(profile, 'manage_groups')
  if (!profile?.tenant_id || (!managerAllowed && !['teacher', 'university_admin', 'super_admin'].includes(profile.role ?? ''))) {
    return { error: 'Forbidden', status: 403, profile: null, group: null }
  }

  const { data: group } = await adminClient()
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single()

  if (!group || group.tenant_id !== profile.tenant_id) {
    return { error: 'Group not found', status: 404, profile: null, group: null }
  }

  if (profile.role === 'teacher' && group.teacher_id !== userId) {
    return { error: 'Forbidden', status: 403, profile: null, group: null }
  }

  return { error: null, status: 200, profile, group }
}

// GET /api/group-students?group_id=xxx
// Returns the list of students enrolled in a group
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const groupId = new URL(request.url).searchParams.get('group_id')
  if (!groupId) return NextResponse.json({ error: 'Missing group_id' }, { status: 400 })

  const { error, status } = await resolveGroupOwnership(user.id, groupId)
  if (error) return NextResponse.json({ error }, { status })

  const { data, error: dbErr } = await adminClient()
    .from('group_students')
    .select('student_id, users!group_students_student_id_fkey(id, full_name, email)')
    .eq('group_id', groupId)

  if (dbErr) {
    console.error('[group-students GET]', dbErr)
    return NextResponse.json({ error: 'Failed to fetch students' }, { status: 500 })
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { group_id?: string; student_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { group_id, student_id } = body
  if (!group_id || !student_id) {
    return NextResponse.json({ error: 'Missing group_id or student_id' }, { status: 400 })
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
    return NextResponse.json({ error: 'Student not found in this institution' }, { status: 404 })
  }

  // Group rule: seat cap (max_students NULL = no cap; column absent pre-migration).
  const { max_students: maxStudents, course_id: courseId } = group as { max_students?: number | null; course_id?: string | null }
  if (maxStudents) {
    const { count } = await adminClient()
      .from('group_students').select('student_id', { count: 'exact', head: true }).eq('group_id', group_id)
    const { data: already } = await adminClient()
      .from('group_students').select('student_id').eq('group_id', group_id).eq('student_id', student_id).maybeSingle()
    if (!already && (count ?? 0) >= maxStudents) {
      return NextResponse.json({ error: `المجموعة ممتلئة (${maxStudents} طالب كحد أقصى)` }, { status: 409 })
    }
  }

  const { error: dbErr } = await adminClient()
    .from('group_students')
    .upsert({ group_id, student_id }, { onConflict: 'group_id,student_id', ignoreDuplicates: true })

  if (dbErr) {
    console.error('[group-students POST]', dbErr)
    return NextResponse.json({ error: 'Failed to enroll student' }, { status: 500 })
  }

  // A group that is a section of a course also enrols the student in that course.
  // The reverse never happens: joining a course by its link adds no group.
  if (courseId) {
    const { error: enrolErr } = await adminClient()
      .from('course_enrollments')
      .upsert({ course_id: courseId, student_id, tenant_id: group.tenant_id }, { onConflict: 'course_id,student_id', ignoreDuplicates: true })
    if (enrolErr) console.error('[group-students POST] course enrolment', enrolErr)
  }

  return NextResponse.json({ student: { id: student.id, full_name: student.full_name, email: student.email } }, { status: 201 })
}

// DELETE /api/group-students — remove a student
// Body: { group_id, student_id }
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { group_id?: string; student_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { group_id, student_id } = body
  if (!group_id || !student_id) {
    return NextResponse.json({ error: 'Missing group_id or student_id' }, { status: 400 })
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
    return NextResponse.json({ error: 'Failed to remove student' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
