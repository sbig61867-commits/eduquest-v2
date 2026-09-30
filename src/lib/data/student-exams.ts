import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The student's exam list — metadata only (PERFORMANCE_CONTRACT.md P3, P10).
 *
 * Every screen that lists a student's exams, homework, quizzes or tasks reads
 * them through here. The rows never carry questions: those reach the browser
 * only from /api/exam/start, once the roster, the window and Safe Exam Browser
 * have been checked and the attempt exists (see exam-delivery.ts).
 *
 * Source: the get_student_exam_list() RPC (supabase/student_exam_list_migration.sql),
 * RLS-scoped through the caller's own session — same rows, same authorization
 * as the old get_student_exams().
 */
export interface StudentExamMeta {
  id: string
  tenant_id: string
  group_id: string | null
  course_id: string | null
  teacher_id: string
  title: string
  duration_minutes: number
  is_published: boolean
  proctoring_enabled: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
  group_name: string | null
  course_title: string | null
  type: 'exam' | 'homework'
  lesson_id: string | null
  assigned_student_id: string | null
  source_exam_id: string | null
  instructions: string | null
  /** Private storage paths; pages sign them into attachment_urls. */
  attachments: string[] | null
  counts_toward_grade: boolean | null
  question_count: number
  /** Any question the teacher grades by hand (essay, short answer) — see isScoreVisible. */
  has_manual_questions: boolean
  total_points: number
}

/** A listed exam as a screen hands it to the exam screen (attachments signed). */
export type StudentExam = StudentExamMeta & { attachment_urls?: string[] }

export async function loadStudentExamList(
  db: SupabaseClient,
): Promise<{ data: StudentExamMeta[]; error: { message: string } | null }> {
  const { data, error } = await db.rpc('get_student_exam_list')
  if (error) return { data: [], error }
  return {
    data: ((data ?? []) as StudentExamMeta[]).map(r => ({ ...r, total_points: Number(r.total_points) || 0 })),
    error: null,
  }
}
