import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

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

const ALLOWED_TYPES = new Set([
  'face_not_detected', 'multiple_faces', 'looking_away', 'suspicious_activity',
  'tab_switch', 'fullscreen_exit', 'audio_detected',
])

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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { examId?: string; events?: IncomingEvent[] }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { examId, events } = body
  if (!examId || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: 'Missing examId or events' }, { status: 400 })
  }
  if (events.length > 50) {
    return NextResponse.json({ error: 'Too many events in one batch' }, { status: 413 })
  }

  // Sanitize + whitelist. Anything unknown is dropped silently.
  const nowIso = new Date().toISOString()
  const clean = events
    .filter(e => e && ALLOWED_TYPES.has(e.type))
    .slice(0, 50)
    .map(e => ({
      type: e.type,
      timestamp: typeof e.timestamp === 'string' ? e.timestamp : nowIso,
      first_at: typeof e.first_at === 'string' ? e.first_at : undefined,
      count: Number.isFinite(e.count) && (e.count as number) > 0 ? Math.min(Math.floor(e.count as number), 10_000) : 1,
      details: typeof e.details === 'string' ? e.details.slice(0, 200) : undefined,
    }))

  if (clean.length === 0) {
    return NextResponse.json({ ok: true, appended: 0 })
  }

  // Verify exam is published + proctored (service role — students can't SELECT exams).
  const { data: exam } = await adminClient()
    .from('exams')
    .select('id, group_id, proctoring_enabled')
    .eq('id', examId)
    .eq('is_published', true)
    .single()
  if (!exam?.proctoring_enabled) {
    return NextResponse.json({ ok: true, appended: 0 })
  }

  // Verify the student is enrolled in the exam's group before writing.
  const { data: enrollment } = await supabase
    .from('group_students')
    .select('student_id')
    .eq('group_id', exam.group_id)
    .eq('student_id', user.id)
    .single()
  if (!enrollment) {
    return NextResponse.json({ error: 'Not enrolled in this exam' }, { status: 403 })
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
    return NextResponse.json({ error: 'Failed to record events' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, appended: clean.length })
}
