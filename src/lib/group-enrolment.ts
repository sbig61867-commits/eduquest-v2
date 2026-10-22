import type { SupabaseClient } from '@/lib/db'

// Adding a student to a group, shared by /api/group-students and direct
// account creation (/api/admin/create-user): the group's seat cap and the
// course a group may be a section of (group_course_transfer_migration.sql).

export interface EnrolmentGroup {
  id: string
  tenant_id: string
  /** NULL = no cap; absent before group_course_transfer_migration.sql. */
  max_students?: number | null
  /** A group that is a section of a course also enrols its students there. */
  course_id?: string | null
}

/** Is there a seat left for this student (always true when already a member)? */
export async function groupHasRoom(admin: SupabaseClient, group: EnrolmentGroup, studentId?: string): Promise<boolean> {
  if (!group.max_students) return true
  if (studentId) {
    const { data: already } = await admin
      .from('group_students').select('student_id').eq('group_id', group.id).eq('student_id', studentId).maybeSingle()
    if (already) return true
  }
  const { count } = await admin
    .from('group_students').select('student_id', { count: 'exact', head: true }).eq('group_id', group.id)
  return (count ?? 0) < group.max_students
}

/**
 * Add the student to the group (idempotent) and, when the group belongs to a
 * course, enrol them in it. The reverse never happens: joining a course by its
 * link adds no group. Returns the group_students error, if any; a failed course
 * enrolment is logged but does not undo the group membership.
 */
export async function enrolStudentInGroup(admin: SupabaseClient, group: EnrolmentGroup, studentId: string) {
  const { error } = await admin
    .from('group_students')
    .upsert({ group_id: group.id, student_id: studentId }, { onConflict: 'group_id,student_id', ignoreDuplicates: true })
  if (error) return { error }

  if (group.course_id) {
    const { error: enrolErr } = await admin
      .from('course_enrollments')
      .upsert({ course_id: group.course_id, student_id: studentId, tenant_id: group.tenant_id }, { onConflict: 'course_id,student_id', ignoreDuplicates: true })
    if (enrolErr) console.error('[group-enrolment] course enrolment', enrolErr)
  }
  return { error: null }
}
