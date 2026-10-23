import { currentCtx } from '@/lib/auth/current'
import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { onRosterSql } from '@/lib/exam-roster'
import { signFileMap } from '@/lib/exam-files'
import { normalizeSebKey, verifySebProof, type SebProof } from '@/lib/seb'
import { studentQuestions } from '@/lib/exam-delivery'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Students have no direct SELECT on exams (answer-leak fix): the exam is read
// as app_service pinned to the student's own institution, and authorization is
// the roster check below (and again, independently, inside start_exam_attempt).
type ExamRow = {
  id: string; tenant_id: string; group_id: string | null; course_id: string | null; assigned_student_id: string | null
  starts_at: string | null; ends_at: string | null; seb_config_key: string | null; questions: unknown
  on_roster: boolean; group_active: boolean | null; in_progress: boolean
}

// The refusals start_exam_attempt raises by name (supabase/fix_start_exam_attempt_migration.sql,
// individual_tasks_migration.sql). Matched exactly, never by substring.
const START_REFUSALS: Record<string, { code: ApiErrorCode; status: number }> = {
  ALREADY_SUBMITTED: { code: 'examAlreadySubmitted', status: 409 },
  EXAM_NOT_FOUND:    { code: 'examNotFound',         status: 404 },
  NOT_ENROLLED:      { code: 'notEnrolledInExam',    status: 403 },
  TENANT_MISMATCH:   { code: 'notEnrolledInExam',    status: 403 },
  EXAM_NOT_OPEN:     { code: 'examNotOpen',          status: 403 },
  EXAM_CLOSED:       { code: 'examEnded',            status: 403 },
}

/**
 * POST /api/exam/start
 *
 * Records the authoritative server-side start time for a student's exam attempt.
 * Idempotent: calling again while in progress returns the existing start time
 * (so a refresh resumes rather than resets). Rejects if already submitted.
 *
 * This replaces the previous client-side upsert, which (a) could not write under
 * RLS and (b) let the client control the start time. Duration is now enforced by
 * the DB against this server timestamp.
 *
 * It is also the ONLY way a student receives an exam's questions
 * (PERFORMANCE_CONTRACT.md P3): the exam list is metadata only, and the
 * questions — answer key stripped — are returned here, after the roster, the
 * window and SEB checks and once the attempt exists. A start or a resume
 * (refresh, second device) returns the same questions.
 */
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  let body: { examId?: string; seb?: SebProof | null }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { examId } = body
  if (!examId) return NextResponse.json({ ...(await apiErr('missingExamId')) }, { status: 400 })
  if (!UUID.test(examId) || !ctx.tenant_id) return NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 })
  const service = { as: 'service', tenantId: ctx.tenant_id } as const

  // One unit for every check before the start (it used to be four round trips):
  // the exam (published, not archived — start_exam_attempt refuses a deleted
  // exam too, but a clear 404 first is better), whether the student is on its
  // roster (its group, or its course; the assigned student of an individual
  // task), whether its group is archived and whether an attempt is under way.
  const [rows] = await run(service, sql => [sql`
    select e.id, e.tenant_id, e.group_id, e.course_id, e.assigned_student_id, e.starts_at, e.ends_at, e.seb_config_key, e.questions,
           ${onRosterSql(sql, user.id)} as on_roster,
           g.is_active as group_active,
           exists (select 1 from public.exam_submissions s where s.exam_id = e.id and s.student_id = ${user.id} and s.status = 'in_progress') as in_progress
      from public.exams e
      left join public.groups g on g.id = e.group_id
     where e.id = ${examId} and e.is_published and e.deleted_at is null`])
  const exam = maybeOne<ExamRow>(rows)

  if (!exam) return NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 })
  if (!exam.on_roster) return NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 })

  // An archived group (is_active = false) is hidden from its students: no NEW attempt
  // starts on one of its exams. An attempt already in progress resumes exactly as before,
  // so archiving never breaks an exam that is under way. Course exams (no group) are not
  // affected. Checked here only — start_exam_attempt is unchanged (owner's decision, Option A).
  if (exam.group_id && exam.group_active === false && !exam.in_progress) {
    return NextResponse.json({ ...(await apiErr('examGroupArchived')) }, { status: 403 })
  }

  // Enforce the exam window at start time too (clear error before they begin)
  const now = Date.now()
  if (exam.starts_at && now < new Date(exam.starts_at).getTime()) {
    return NextResponse.json({ ...(await apiErr('examNotOpen')) }, { status: 403 })
  }
  if (exam.ends_at && now > new Date(exam.ends_at).getTime()) {
    return NextResponse.json({ ...(await apiErr('examEnded')) }, { status: 403 })
  }

  // Optional Safe Exam Browser requirement (src/lib/seb.ts): only SEB running
  // the teacher's exact configuration can produce this proof. The column
  // exists once supabase/seb_config_key_migration.sql is applied.
  const sebKey = normalizeSebKey(exam.seb_config_key)
  if (sebKey && !verifySebProof(sebKey, body.seb, new URL(request.url).origin)) {
    return NextResponse.json({ ...(await apiErr('sebRequired')), seb_required: true }, { status: 403 })
  }

  // start_exam_attempt runs as app_service (EXECUTE is revoked from the user
  // roles): a student cannot start or spoof an attempt for another student_id
  // or an arbitrary tenant_id by calling it directly. It re-checks everything
  // above (R-1). Only the exact messages it raises itself (SQLSTATE P0001) are
  // translated; anything else is an unexpected failure and stays a 500.
  let out: { started_at: string; resumed: boolean; answers_draft?: Record<string, string> }
  let answerFilesRaw: Record<string, string> | null = null
  try {
    const individual = exam.assigned_student_id === user.id
    const results = await run(service, sql => [
      sql`select public.start_exam_attempt(${examId}, ${user.id}, ${exam.tenant_id}) as r`,
      // an individual task can carry photos of handwritten answers; a resumed attempt shows them again
      ...(individual ? [sql`select answer_files from public.exam_submissions where exam_id = ${examId} and student_id = ${user.id}`] : []),
    ])
    const result = maybeOne<{ r: Record<string, unknown> | null }>(results[0])?.r
    if (!result || typeof result.started_at !== 'string' || typeof result.resumed !== 'boolean') {
      console.error('[exam/start] unexpected start_exam_attempt result shape', result)
      return NextResponse.json({ ...(await apiErr('examStartFailed')) }, { status: 500 })
    }
    out = result as typeof out
    if (individual && out.resumed) answerFilesRaw = maybeOne<{ answer_files: Record<string, string> | null }>(results[1])?.answer_files ?? null
  } catch (error) {
    const e = error as { code?: string; message?: string }
    const refusal = e.code === 'P0001' ? START_REFUSALS[e.message ?? ''] : undefined
    if (refusal) return NextResponse.json({ ...(await apiErr(refusal.code)) }, { status: refusal.status })
    console.error('[exam/start] error', e.message)
    return NextResponse.json({ ...(await apiErr('examStartFailed')) }, { status: 500 })
  }
  const answerFiles = answerFilesRaw ? await signFileMap(answerFilesRaw) : {}

  // The exam screen restores these answers on resume (refresh / second device),
  // and renders these questions — never correct_answer.
  return NextResponse.json({
    startedAt: out.started_at, resumed: out.resumed, answers_draft: out.answers_draft ?? {}, answer_files: answerFiles,
    questions: studentQuestions(exam.questions),
  })
}
