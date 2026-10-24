import type { Sql } from '@/lib/db/sql'

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

export interface RosterRow {
  student_id: string
  users: { full_name: string | null; email: string | null } | null
}

/**
 * The same roster rule on the SQL layer (step 9), as a fragment for a
 * statement whose exam row is aliased `e`: true when the student is in the
 * exam's group, or — for a course exam — enrolled in its course, and is the
 * assigned student of an individual task. Run as app_service pinned to the
 * student's institution, whose policies scope both tables.
 */
export function onRosterSql(sql: Sql, studentId: string) {
  return sql`(
    (e.assigned_student_id is null or e.assigned_student_id = ${studentId})
    and (
      (e.group_id is not null and exists (select 1 from public.group_students gs where gs.group_id = e.group_id and gs.student_id = ${studentId}))
      or (e.group_id is null and e.course_id is not null and exists (select 1 from public.course_enrollments ce where ce.course_id = e.course_id and ce.student_id = ${studentId}))
    )
  )`
}
