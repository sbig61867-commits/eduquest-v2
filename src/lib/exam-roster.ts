import type { SupabaseClient } from '@/lib/db'

// An exam belongs to exactly one group OR one course (the DB enforces it with
// CHECK exam_must_belong_to_group_or_course). Its roster is therefore either
// the group's members or the course's enrolled students — never both.
//
// Every route that lets a student act on an exam (start, submit, proctoring
// events, evidence, live stream) asks the same question, so it lives here
// rather than as a group-only query copied into each route. The database
// functions start_exam_attempt / append_proctoring_events apply the same rule
// (supabase/course_assessments_migration.sql), plus one more for individual
// follow-up tasks: when assigned_student_id is set, that student alone
// (supabase/individual_tasks_migration.sql).

export interface ExamScope {
  group_id: string | null
  course_id: string | null
  /** Set on an individual follow-up task: only this student may take it. */
  assigned_student_id?: string | null
}

/** True when `studentId` is on the exam's roster. */
export async function isOnExamRoster(db: SupabaseClient, exam: ExamScope, studentId: string): Promise<boolean> {
  if (exam.assigned_student_id && exam.assigned_student_id !== studentId) return false
  if (exam.group_id) {
    const { data } = await db
      .from('group_students')
      .select('student_id')
      .eq('group_id', exam.group_id)
      .eq('student_id', studentId)
      .maybeSingle()
    return !!data
  }
  if (exam.course_id) {
    const { data } = await db
      .from('course_enrollments')
      .select('student_id')
      .eq('course_id', exam.course_id)
      .eq('student_id', studentId)
      .maybeSingle()
    return !!data
  }
  return false
}

export interface RosterRow {
  student_id: string
  users: { full_name: string | null; email: string | null } | null
}

/** Everyone expected to take the exam, with their name and email. */
export async function examRoster(db: SupabaseClient, exam: ExamScope): Promise<RosterRow[]> {
  const table = exam.group_id ? 'group_students' : exam.course_id ? 'course_enrollments' : null
  if (!table) return []
  let query = db
    .from(table)
    .select('student_id, users:student_id(full_name, email)')
    .eq(exam.group_id ? 'group_id' : 'course_id', (exam.group_id ?? exam.course_id)!)
  // An individual task's roster is its one student (still required to be a member).
  if (exam.assigned_student_id) query = query.eq('student_id', exam.assigned_student_id)
  const { data } = await query
  return (data ?? []) as unknown as RosterRow[]
}
