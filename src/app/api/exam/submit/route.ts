import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Students no longer have direct SELECT on exams (answer-leak fix). The exam
// (incl. correct_answer, used for server-side grading) is read with the
// service-role client; authorization is enforced by the enrollment check below.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * POST /api/exam/submit
 *
 * Receives student answers + client-only proctoring events, calculates
 * score server-side from DB (never trusts client score), merges with
 * server-written proctoring_events already in DB, then writes final record.
 *
 * Security properties:
 * - correct_answer never leaves the server — grading is authoritative
 * - score cannot be forged by the client
 * - proctoring_events from server (Gemini) are preserved and merged
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    examId?: string
    answers?: Record<string, string>
    clientViolations?: Array<{ type: string; timestamp: string; details?: string }>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { examId, answers, clientViolations } = body

  if (!examId || typeof answers !== 'object' || answers === null) {
    return NextResponse.json({ error: 'Missing examId or answers' }, { status: 400 })
  }

  // Verify the student belongs to this exam's group (via group_students)
  const { data: exam } = await adminClient()
    .from('exams')
    .select('id, tenant_id, group_id, questions, proctoring_enabled')
    .eq('id', examId)
    .eq('is_published', true)
    .single()

  if (!exam) {
    return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
  }

  // Verify student is enrolled in the group that owns this exam
  const { data: enrollment } = await supabase
    .from('group_students')
    .select('student_id')
    .eq('group_id', exam.group_id)
    .eq('student_id', user.id)
    .single()

  if (!enrollment) {
    return NextResponse.json({ error: 'Not enrolled in this exam' }, { status: 403 })
  }

  // Grade server-side using correct_answer from DB — never from client
  const questions: Array<{ id: string; correct_answer: string; points: number }> =
    exam.questions ?? []

  let score = 0
  const maxScore = questions.reduce((s, q) => s + q.points, 0)
  for (const q of questions) {
    const studentAnswer = answers[q.id]?.trim().toLowerCase() ?? ''
    if (studentAnswer === q.correct_answer?.trim().toLowerCase()) {
      score += q.points
    }
  }

  // Merge server-written violations (already in DB from Gemini) with
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
  // all in one transaction. Grading itself stays server-side (above); the RPC only
  // persists the already-computed score so the client can never forge it.
  const { data: result, error: rpcError } = await supabase.rpc('finalize_exam_submission', {
    p_exam_id: examId,
    p_student_id: user.id,
    p_answers: answers,
    p_client_events: safeClientEvents,
    p_score: score,
    p_max_score: maxScore,
  })

  if (rpcError) {
    // Map domain errors raised by the RPC to clear client responses.
    const msg = rpcError.message ?? ''
    const MAP: Record<string, { status: number; error: string }> = {
      NOT_STARTED:       { status: 409, error: 'You must start the exam before submitting.' },
      ALREADY_SUBMITTED: { status: 409, error: 'This exam has already been submitted.' },
      EXAM_NOT_OPEN:     { status: 403, error: 'This exam is not open yet.' },
      EXAM_CLOSED:       { status: 403, error: 'The exam window has closed.' },
      TIME_EXPIRED:      { status: 403, error: 'Your time for this exam has expired.' },
      EXAM_NOT_FOUND:    { status: 404, error: 'Exam not found.' },
    }
    const hit = Object.keys(MAP).find(code => msg.includes(code))
    if (hit) return NextResponse.json({ error: MAP[hit].error }, { status: MAP[hit].status })
    console.error('[exam/submit] finalize error', rpcError)
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
  }

  if (
    !result ||
    typeof (result as Record<string, unknown>).score !== 'number' ||
    typeof (result as Record<string, unknown>).max_score !== 'number'
  ) {
    console.error('[exam/submit] unexpected RPC result shape', result)
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
  }
  const out = result as { score: number; max_score: number }
  return NextResponse.json({ score: out.score, maxScore: out.max_score })
}
