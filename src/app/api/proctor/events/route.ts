import { ALLOWED_EVENT_TYPES } from '@/lib/proctoring-events'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { isOnExamRoster } from '@/lib/exam-roster'
import { rateLimit } from '@/lib/rate-limit'

// Browser clocks can be set to anything. Keep a client time only when it is a
// real date within the recorder's batching window of the server's clock
// (events are at most a few flushes old); otherwise the caller uses server time.
const CLIENT_TIME_PAST_MS = 5 * 60_000
const CLIENT_TIME_FUTURE_MS = 5_000
function clientTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 40) return undefined
  const t = Date.parse(value)
  const now = Date.now()
  if (!Number.isFinite(t) || t < now - CLIENT_TIME_PAST_MS || t > now + CLIENT_TIME_FUTURE_MS) return undefined
  return new Date(t).toISOString()
}

// Records LOCAL proctoring detections (from the in-browser MediaPipe/TF/audio
// layers) into the exam submission. NO AI is used here — this endpoint never
// calls Gemini or any model; it only persists batched, client-deduped events.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Every accepted type and what it means: src/lib/proctoring-events.ts.
const ALLOWED_TYPES = ALLOWED_EVENT_TYPES

interface IncomingEvent {
  type: string
  timestamp?: string
  first_at?: string
  count?: number
  details?: string
}

// POST /api/proctor/events  { examId, events: [{type, timestamp, first_at, count, details}] }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { examId?: string; events?: IncomingEvent[] }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { examId, events } = body
  if (!examId || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ ...(await apiErr('missingExamOrEvents')) }, { status: 400 })
  }
  if (events.length > 50) {
    return NextResponse.json({ ...(await apiErr('tooManyEvents')) }, { status: 413 })
  }

  // The recorder flushes every ~15 s; 600 batches/hour is generous for a real
  // exam but stops a student turning the JSONB log into an unbounded write.
  const limit = await rateLimit(`proctor-events:${user.id}`, { limit: 600, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  // Sanitize + whitelist. Anything unknown is dropped silently.
  const nowIso = new Date().toISOString()
  const clean = events
    .filter(e => e && ALLOWED_TYPES.has(e.type))
    .slice(0, 50)
    .map(e => ({
      type: e.type,
      timestamp: clientTime(e.timestamp) ?? nowIso,
      first_at: clientTime(e.first_at),
      count: Number.isFinite(e.count) && (e.count as number) > 0 ? Math.min(Math.floor(e.count as number), 10_000) : 1,
      details: typeof e.details === 'string' ? e.details.slice(0, 200) : undefined,
    }))

  if (clean.length === 0) {
    return NextResponse.json({ ok: true, appended: 0 })
  }

  // Verify exam is published + proctored (service role — students can't SELECT exams).
  const { data: exam } = await adminClient()
    .from('exams')
    .select('proctoring_enabled, group_id, course_id, assigned_student_id')
    .eq('id', examId)
    .eq('is_published', true)
    .single()
  if (!exam?.proctoring_enabled) {
    return NextResponse.json({ ok: true, appended: 0 })
  }

  // Verify the student is on the exam's roster before writing.
  if (!(await isOnExamRoster(supabase, exam, user.id))) {
    return NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 })
  }

  // Reuse the existing atomic appender (jsonb concat, SECURITY DEFINER). It only
  // writes while status = 'in_progress', so post-submit batches are ignored.
  // Service-role client so EXECUTE can be revoked from anon/authenticated (see
  // migration): the appender must not be reachable directly, or any user could
  // inject fabricated proctoring events against another student's attempt.
  const { error } = await adminClient().rpc('append_proctoring_events', {
    p_exam_id: examId,
    p_student_id: user.id,
    p_events: clean,
  })
  if (error) {
    console.error('[proctor/events]', error)
    return NextResponse.json({ ...(await apiErr('eventsFailed')) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, appended: clean.length })
}
