import { run, maybeOne } from '@/lib/db/sql'
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
 *   test of the event types. (`exam_submissions.is_flagged` is not used.)
 * - Read as the teacher, ONE statement (totals, page clamp, rows): RLS decides
 *   which submissions are visible; the teacher / proctoring filters are the
 *   page's own, unchanged.
 */

export const PROCTORING_PAGE_SIZE = 20

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

export async function loadProctoringPage(
  teacherId: string,
  rawPage: unknown,
): Promise<{ data: ProctoringPage; error: { message: string } | null }> {
  const size = PROCTORING_PAGE_SIZE
  try {
    const [rows] = await run({ as: 'user', userId: teacherId }, sql => [
      sql`with subs as (
             select s.id, s.score, s.max_score, s.submitted_at, s.proctoring_events, s.student_id, e.title as exam_title
               from public.exam_submissions s join public.exams e on e.id = s.exam_id
              where e.teacher_id = ${teacherId} and e.proctoring_enabled),
           totals as (
             select count(*)::int as total,
                    count(*) filter (where jsonb_typeof(proctoring_events) = 'array' and exists (
                      select 1 from jsonb_array_elements(proctoring_events) ev
                       where ev->>'type' in (select jsonb_array_elements_text(${sql.json(VIOLATION_TYPES)}))))::int as flagged
               from subs),
           pg as (select least(${parsePage(rawPage)}, greatest(1, ceil(total / ${size}::numeric)::int)) as p from totals)
      select (select total from totals) as total, (select flagged from totals) as flagged, (select p from pg) as page,
             coalesce((select json_agg(json_build_object('id', x.id, 'score', x.score, 'max_score', x.max_score,
                               'submitted_at', x.submitted_at, 'proctoring_events', x.proctoring_events,
                               'exams', json_build_object('title', x.exam_title),
                               'users', case when u.id is null then null else json_build_object('full_name', u.full_name, 'email', u.email) end)
                               order by x.submitted_at desc, x.id)
                         from (select * from subs order by submitted_at desc, id
                                limit ${size} offset ((select p from pg) - 1) * ${size}) x
                         left join public.users u on u.id = x.student_id), '[]') as rows`,
    ])
    const r = maybeOne<{ total: number; flagged: number; page: number; rows: ProctoredSubmission[] }>(rows)
      ?? { total: 0, flagged: 0, page: 1, rows: [] }
    return { data: { ...r, pageCount: Math.max(1, Math.ceil(r.total / size)) }, error: null }
  } catch (e) {
    return { data: { rows: [], total: 0, flagged: 0, page: 1, pageCount: 1 }, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}
