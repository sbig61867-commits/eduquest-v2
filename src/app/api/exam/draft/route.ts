import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/exam/draft
 *
 * Saves the student's in-progress answers server-side so they can resume
 * from a different device. Only works while the attempt is 'in_progress'.
 * Only for timed exams (homework doesn't need this — it has no time pressure).
 */
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  // Each save rewrites up to ~10 MB of JSONB; the client autosaves every few
  // seconds at most, so 240/hour is generous and stops a scripted flood.
  const limit = await rateLimit(`exam-draft:${user.id}`, { limit: 240, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  let body: { examId?: string; answers?: Record<string, string> }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { examId, answers } = body
  if (!examId || !answers || typeof answers !== 'object') {
    return NextResponse.json({ ...(await apiErr('missingExamOrAnswers')) }, { status: 400 })
  }
  // The draft is stored verbatim as JSONB, so bound it: string answers only,
  // a sane number of questions and answer length. Without this any student
  // could park megabytes of arbitrary JSON on their submission row.
  const entries = Object.entries(answers)
  if (
    Array.isArray(answers) || entries.length > 500 ||
    entries.some(([k, v]) => k.length > 100 || typeof v !== 'string' || v.length > 20000)
  ) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  // Only update if the attempt is still in_progress (never overwrite a submitted attempt)
  if (!UUID.test(examId) || !ctx.tenant_id) return NextResponse.json({ ...(await apiErr('missingExamOrAnswers')) }, { status: 400 })

  // Only the caller's own attempt, only while it is in progress; as app_service
  // pinned to the student's institution (students cannot write submissions).
  try {
    await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [sql`
      update public.exam_submissions set answers_draft = ${sql.json(answers)}
       where exam_id = ${examId} and student_id = ${user.id}
         and status = 'in_progress'`])  // grading_status is pending|reviewing|published — never in_progress
  } catch (error) {
    console.error('[exam/draft] error', error instanceof Error ? error.message : error)
    return NextResponse.json({ ...(await apiErr('draftSaveFailed')) }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
