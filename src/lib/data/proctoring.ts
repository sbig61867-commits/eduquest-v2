import type { SupabaseClient } from '@/lib/db'
import { parsePage } from '@/lib/data/people'
import { VIOLATION_TYPES } from '@/lib/proctoring-events'
import type { ProctoringEvent } from '@/types'

/**
 * /teacher/proctoring (Batch 3 / P-01): a teacher's proctored submissions one
 * page at a time, newest first, with the totals counted by the database —
 * instead of every submission ever made, each carrying the exam's questions.
 *
 * - The score's maximum is the submission's own `max_score` (written by
 *   finalize_exam_submission as the sum of the question points — what the page
 *   used to add up from the questions); null only while an attempt is open.
 * - «Flagged» = at least one VIOLATION event, the same rule as the page
 *   (eventKind === 'violation'), counted in the database with one JSONB
 *   containment test per violation type. (`exam_submissions.is_flagged` is
 *   never written, so it is not used.)
 * - Runs on the teacher's session: RLS decides which submissions are visible;
 *   the teacher / proctoring filters are the page's own, unchanged.
 */

export const PROCTORING_PAGE_SIZE = 20

/** PostgREST: the requested range starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

/** `or=(…)` value: the submission has at least one violation event. */
export function violationFilter(): string {
  return VIOLATION_TYPES.map(type => `proctoring_events.cs.${JSON.stringify([{ type }])}`).join(',')
}

export interface ProctoredSubmission {
  id: string
  score: number | null
  max_score: number | null
  submitted_at: string
  proctoring_events: ProctoringEvent[] | null
  exams: { title: string } | null
  users: { full_name: string; email: string } | null
}

export interface ProctoringPage {
  rows: ProctoredSubmission[]
  total: number
  flagged: number
  page: number
  pageCount: number
}

const ROW_COLUMNS = 'id, score, max_score, submitted_at, proctoring_events, exams!inner(title), users(full_name, email)'

export async function loadProctoringPage(
  db: SupabaseClient,
  teacherId: string,
  rawPage: unknown,
): Promise<{ data: ProctoringPage; error: { message: string } | null }> {
  const fetchRows = (page: number) => {
    const from = (page - 1) * PROCTORING_PAGE_SIZE
    return db.from('exam_submissions').select(ROW_COLUMNS)
      .eq('exams.teacher_id', teacherId).eq('exams.proctoring_enabled', true)
      .order('submitted_at', { ascending: false }).order('id', { ascending: true })
      .range(from, from + PROCTORING_PAGE_SIZE - 1)
  }

  const [totalRes, flaggedRes] = await Promise.all([
    db.from('exam_submissions').select('id, exams!inner(teacher_id)', { count: 'exact', head: true })
      .eq('exams.teacher_id', teacherId).eq('exams.proctoring_enabled', true),
    db.from('exam_submissions').select('id, exams!inner(teacher_id)', { count: 'exact', head: true })
      .eq('exams.teacher_id', teacherId).eq('exams.proctoring_enabled', true).or(violationFilter()),
  ])
  const empty: ProctoringPage = { rows: [], total: 0, flagged: 0, page: 1, pageCount: 1 }
  const countErr = totalRes.error ?? flaggedRes.error
  if (countErr) return { data: empty, error: countErr }

  const total = totalRes.count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PROCTORING_PAGE_SIZE))
  let page = Math.min(parsePage(rawPage), pageCount)
  let rowsRes = await fetchRows(page)
  if (rowsRes.error?.code === RANGE_NOT_SATISFIABLE) {
    page = pageCount
    rowsRes = await fetchRows(page)
  }
  if (rowsRes.error) return { data: empty, error: rowsRes.error }

  return {
    data: { rows: (rowsRes.data ?? []) as unknown as ProctoredSubmission[], total, flagged: flaggedRes.count ?? 0, page, pageCount },
    error: null,
  }
}
