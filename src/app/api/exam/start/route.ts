import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminDb } from '@/lib/db'
import { isOnExamRoster } from '@/lib/exam-roster'
import { signFileMap } from '@/lib/exam-files'
import { normalizeSebKey, verifySebProof, type SebProof } from '@/lib/seb'
import { studentQuestions } from '@/lib/exam-delivery'

// Students no longer have direct SELECT on exams (answer-leak fix). Reading exam
// metadata here uses the service-role client; authorization is enforced
// separately by the enrollment check below.
function adminClient() {
  return getAdminDb()
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { examId?: string; seb?: SebProof | null }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { examId } = body
  if (!examId) return NextResponse.json({ ...(await apiErr('missingExamId')) }, { status: 400 })

  // Verify the exam exists, is published and is not archived (soft-deleted),
  // and resolve its tenant + group. start_exam_attempt refuses a deleted exam
  // too (EXAM_NOT_FOUND); checking here as well means a deleted exam is refused
  // before anything else runs, with a clear 404 rather than a generic failure.
  const { data: exam } = await adminClient()
    .from('exams')
    .select('id, tenant_id, group_id, course_id, assigned_student_id, starts_at, ends_at, seb_config_key, questions')
    .eq('id', examId)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single()

  if (!exam) return NextResponse.json({ ...(await apiErr('examNotFound')) }, { status: 404 })

  // Verify the student is on the exam's roster (its group, or its course)
  if (!(await isOnExamRoster(supabase, exam, user.id))) return NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 })

  // An archived group (is_active = false) is hidden from its students: no NEW attempt
  // starts on one of its exams. An attempt already in progress resumes exactly as before,
  // so archiving never breaks an exam that is under way. Course exams (no group) are not
  // affected. Checked here only — start_exam_attempt is unchanged (owner's decision, Option A).
  if (exam.group_id) {
    const admin = adminClient()
    const { data: group } = await admin.from('groups').select('is_active').eq('id', exam.group_id).maybeSingle()
    if (group?.is_active === false) {
      const { data: attempt } = await admin.from('exam_submissions').select('id')
        .eq('exam_id', exam.id).eq('student_id', user.id).eq('status', 'in_progress').maybeSingle()
      if (!attempt) return NextResponse.json({ ...(await apiErr('examGroupArchived')) }, { status: 403 })
    }
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

  // Via the service-role client so EXECUTE can be revoked from anon/authenticated
  // (see supabase migration): a student cannot start/spoof an attempt for another
  // student_id or an arbitrary tenant_id by calling the RPC directly.
  const { data: result, error } = await adminClient().rpc('start_exam_attempt', {
    p_exam_id: examId,
    p_student_id: user.id,
    p_tenant_id: exam.tenant_id,
  })

  if (error) {
    // The database re-checks everything above (R-1). A refusal there — e.g.
    // the exam was archived or the student removed between the read above and
    // this call — is reported as what it is. Only the exact messages
    // start_exam_attempt raises itself (RAISE EXCEPTION → SQLSTATE P0001) are
    // translated; anything else is an unexpected failure and stays a 500.
    const refusal = error.code === 'P0001' ? START_REFUSALS[error.message ?? ''] : undefined
    if (refusal) {
      return NextResponse.json({ ...(await apiErr(refusal.code)) }, { status: refusal.status })
    }
    console.error('[exam/start] error', error)
    return NextResponse.json({ ...(await apiErr('examStartFailed')) }, { status: 500 })
  }

  if (
    !result ||
    typeof (result as Record<string, unknown>).started_at !== 'string' ||
    typeof (result as Record<string, unknown>).resumed !== 'boolean'
  ) {
    console.error('[exam/start] unexpected RPC result shape', result)
    return NextResponse.json({ ...(await apiErr('examStartFailed')) }, { status: 500 })
  }
  const out = result as { started_at: string; resumed: boolean; answers_draft?: Record<string, string> }

  // An individual task can carry photos of the student's handwritten answers;
  // hand back the ones already uploaded so a resumed attempt still shows them.
  let answerFiles: Record<string, string> = {}
  if (out.resumed && exam.assigned_student_id === user.id) {
    const { data: sub } = await adminClient()
      .from('exam_submissions').select('answer_files').eq('exam_id', examId).eq('student_id', user.id).maybeSingle()
    answerFiles = await signFileMap(sub?.answer_files as Record<string, string> | null)
  }

  // The exam screen restores these answers on resume (refresh / second device),
  // and renders these questions — never correct_answer.
  return NextResponse.json({
    startedAt: out.started_at, resumed: out.resumed, answers_draft: out.answers_draft ?? {}, answer_files: answerFiles,
    questions: studentQuestions(exam.questions),
  })
}
