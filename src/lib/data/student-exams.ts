import type { SupabaseClient } from '@supabase/supabase-js'
import type { Question } from '@/types'
import { isAutoGradable } from '@/lib/score-visibility'

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

interface LegacyRow extends Omit<StudentExamMeta, 'question_count' | 'has_manual_questions' | 'total_points'> {
  questions?: Array<Pick<Question, 'type' | 'points'>> | null
}

/** The same facts get_student_exam_list computes in SQL, from a legacy row. */
export function metaFromLegacyRow(row: LegacyRow): StudentExamMeta {
  const { questions, ...rest } = row
  const list = Array.isArray(questions) ? questions : []
  return {
    ...rest,
    question_count: list.length,
    has_manual_questions: list.some(q => !isAutoGradable(q)),
    total_points: list.reduce((sum, q) => sum + (typeof q.points === 'number' ? q.points : 0), 0),
  }
}

/** PostgREST's code for "no such function" — the migration is not applied yet. */
const FUNCTION_NOT_FOUND = 'PGRST202'

export async function loadStudentExamList(
  db: SupabaseClient,
): Promise<{ data: StudentExamMeta[]; error: { message: string } | null }> {
  const { data, error } = await db.rpc('get_student_exam_list')
  if (!error) {
    return {
      data: ((data ?? []) as StudentExamMeta[]).map(r => ({ ...r, total_points: Number(r.total_points) || 0 })),
      error: null,
    }
  }
  // Until supabase/student_exam_list_migration.sql is applied, fall back to
  // the old feed and drop the questions here, so no screen receives them
  // either way. Remove this branch once the migration is on the live DB.
  if (error.code === FUNCTION_NOT_FOUND) {
    // perf-contract: the one remaining heavy-feed call, pre-migration only.
    const legacy = await db.rpc('get_student_exams')
    if (legacy.error) return { data: [], error: legacy.error }
    return { data: ((legacy.data ?? []) as LegacyRow[]).map(metaFromLegacyRow), error: null }
  }
  return { data: [], error }
}
