/**
 * /teacher/exams list (Batch 3 / P-04): named columns + the question COUNT —
 * never every question of every exam. `question_count` is the PostgREST
 * computed field question_count(exams) (supabase/content_feeds_migration.sql).
 * The questions themselves are read on demand (the questions viewer, the
 * results route). Runs on the teacher's session (RLS), unchanged.
 */

export const TEACHER_EXAM_COLUMNS =
  'id, title, duration_minutes, is_published, proctoring_enabled, created_at, type, ends_at, assigned_student_id, question_count'

export interface TeacherExamRow {
  id: string
  title: string
  duration_minutes: number
  is_published: boolean
  proctoring_enabled: boolean
  created_at: string
  type?: 'exam' | 'homework'
  ends_at?: string | null
  question_count: number
  groups: { name: string } | null
  courses?: { title: string } | null
  assigned_student_id?: string | null
  assignee?: { full_name: string | null } | null
}

/** A full exam row (POST / PATCH /api/exams return one, questions included) as the list keeps it. */
export function toTeacherExamRow(e: Omit<TeacherExamRow, 'question_count'> & { questions?: unknown[] | null; question_count?: number }): TeacherExamRow {
  const { questions, ...rest } = e
  return { ...rest, question_count: typeof e.question_count === 'number' ? e.question_count : Array.isArray(questions) ? questions.length : 0 }
}
