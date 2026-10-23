import { currentCtx } from '@/lib/auth/current'
import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { onRosterSql } from '@/lib/exam-roster'
import { isAutoGradable } from '@/lib/score-visibility'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Students have no direct SELECT on exams (answer-leak fix). The exam (incl.
// correct_answer, used for server-side grading) is read as app_service pinned
// to the student's own institution; authorization is the roster check below.
type ExamRow = {
  id: string; type: string | null; auto_publish: boolean | null
  questions: Array<{ id: string; type?: string; correct_answer?: string; points?: number }> | null
  on_roster: boolean
}

/**
 * POST /api/exam/submit
 *
 * Receives student answers + client-only proctoring events, calculates
 * score server-side from DB (never trusts client score), merges with
 * proctoring_events already persisted in DB by /api/proctor/events, then writes final record.
 *
 * Security properties:
 * - correct_answer never leaves the server — grading is authoritative
 * - score cannot be forged by the client
 * - proctoring_events already in DB (from the on-device detectors) are preserved and merged
 */
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  let body: {
    examId?: string
    answers?: Record<string, string>
    clientViolations?: Array<{ type: string; timestamp: string; details?: string }>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  const { examId, answers, clientViolations } = body

  if (!examId || typeof answers !== 'object' || answers === null) {
    return NextResponse.json({ ...(await apiErr('missingExamOrAnswers')) }, { status: 400 })
  }

  if (!UUID.test(examId) || !ctx.tenant_id) return NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 })
  // As app_service pinned to the student's institution (students cannot read
  // exams, which hold the answer key): the exam and the roster check, one unit.
  const service = { as: 'service', tenantId: ctx.tenant_id } as const
  const [rows] = await run(service, sql => [sql`
    select e.id, e.type, e.auto_publish, e.questions, ${onRosterSql(sql, user.id)} as on_roster
      from public.exams e
     where e.id = ${examId} and e.is_published`])
  const exam = maybeOne<ExamRow>(rows)

  if (!exam) {
    return NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 })
  }

  if (!exam.on_roster) {
    return NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 })
  }

  const questions: Array<{ id: string; type?: string; correct_answer?: string; points?: number }> =
    exam.questions ?? []

  // Same rule as the DB (exam_grading_window_fix_migration.sql): only an
  // auto-gradable question with a non-empty key scores here — an essay stored
  // with correct_answer '' must never match a blank answer.
  let score = 0
  const maxScore = questions.reduce((s, q) => s + (q.points ?? 0), 0)
  for (const q of questions) {
    const key = q.correct_answer?.trim().toLowerCase() ?? ''
    if (!isAutoGradable(q) || !key) continue
    if ((answers[q.id]?.trim().toLowerCase() ?? '') === key) score += q.points ?? 0
  }

  // Merge violations already persisted by /api/proctor/events with
  // client-only events (tab_switch, fullscreen_exit, audio_detected).
  // Only accept client events with known safe types to prevent injection.
  const allowedClientTypes = new Set(['tab_switch', 'fullscreen_exit', 'audio_detected'])
  const safeClientEvents = (clientViolations ?? [])
    .filter(v => allowedClientTypes.has(v.type))
    .map(v => ({
      type: v.type,
      timestamp: v.timestamp,
      details: typeof v.details === 'string' ? v.details.slice(0, 200) : undefined,
    }))

  // Finalize atomically in the DB: this enforces the exam window + per-attempt
  // duration (from the server-recorded start time), locks against re-submission,
  // merges server + client proctoring events, and writes the authoritative grade —
  // all in one transaction.
  //
  // Grade forgery is closed by two independent layers (defence in depth):
  //   1. The RPC recomputes the score in-DB from the stored correct_answer and
  //      ignores p_score entirely — forging a score is structurally impossible,
  //      regardless of who calls the function or how grants are configured.
  //   2. EXECUTE is revoked from anon/authenticated, so the RPC is reachable only
  //      through this service-role call from trusted server code — closing the
  //      direct POST /rest/v1/rpc/finalize_exam_submission path.
  // Both layers live in supabase/rpc_execute_lockdown_migration.sql.
  // finalize_exam_submission runs as app_service: it enforces the attempt
  // state, the window and the time limit, merges the persisted proctoring
  // events and writes the score computed here — the client never sends one.
  let result: Record<string, unknown> | null
  try {
    const [r] = await run(service, sql => [sql`
      select public.finalize_exam_submission(${examId}, ${user.id}, ${sql.json(answers)}, ${sql.json(safeClientEvents)}, ${score}, ${maxScore}) as r`])
    result = maybeOne<{ r: Record<string, unknown> | null }>(r)?.r ?? null
  } catch (error) {
    const msg = (error as { message?: string }).message ?? ''
    const MAP: Record<string, { status: number; code: ApiErrorCode }> = {
      NOT_STARTED:       { status: 409, code: 'examNotStarted' },
      ALREADY_SUBMITTED: { status: 409, code: 'examAlreadySubmitted' },
      EXAM_NOT_OPEN:     { status: 403, code: 'examNotOpen' },
      EXAM_CLOSED:       { status: 403, code: 'examEnded' },
      TIME_EXPIRED:      { status: 403, code: 'examTimeExpired' },
      EXAM_NOT_FOUND:    { status: 404, code: 'examNotFound' },
    }
    const hit = Object.keys(MAP).find(code => msg.includes(code))
    if (hit) return NextResponse.json({ ...(await apiErr(MAP[hit].code)) }, { status: MAP[hit].status })
    console.error('[exam/submit] finalize error', msg)
    return NextResponse.json({ ...(await apiErr('submissionSaveFailed')) }, { status: 500 })
  }

  if (!result || typeof result.score !== 'number' || typeof result.max_score !== 'number') {
    console.error('[exam/submit] unexpected finalize result shape', result)
    return NextResponse.json({ ...(await apiErr('submissionSaveFailed')) }, { status: 500 })
  }
  const out = result as { score: number; max_score: number }

  // Homework auto-publish: when every question is auto-gradable (mcq /
  // true_false) and the teacher didn't disable it, the result goes live for
  // the student immediately — no manual review step needed. Essay-containing
  // homework always stays 'pending' until the teacher grades and publishes.
  // A question the teacher grades by hand means the automatic number is not
  // the mark yet — for an exam as much as for homework: the student sees it
  // only once the teacher publishes (results screen → /api/homework/submissions).
  const hasManual = questions.some(q => !isAutoGradable(q))
  const autoPublish = exam.type === 'homework' && !hasManual && exam.auto_publish !== false
  let published = exam.type !== 'homework' && !hasManual

  if (autoPublish) {
    // A unit of its own: a failure here must never undo the saved submission.
    try {
      await run(service, sql => [sql`update public.exam_submissions set grading_status = 'published' where exam_id = ${examId} and student_id = ${user.id}`])
      published = true
    } catch { /* stays unpublished; the teacher can publish it */ }
  }

  // Withhold the score until it is actually published. The client already
  // hides it (exam-taker only renders finalScore when published), but sending
  // it anyway means a student can read their provisional mark straight out of
  // the network tab before the teacher has reviewed the essay answers.
  // Deciding this server-side makes the client check cosmetic rather than the
  // only thing standing between the student and an unpublished grade.
  return published
    ? NextResponse.json({ score: out.score, maxScore: out.max_score, published: true })
    : NextResponse.json({ published: false })
}
