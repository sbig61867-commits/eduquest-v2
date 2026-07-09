import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Stores a SINGLE evidence snapshot for a SEVERE proctoring violation into the
// private "proctoring-evidence" bucket, and links its path to the event in
// proctoring_events. NO AI — the image is never analyzed by any model; it is
// stored as-is for the teacher to review by eye. No video is ever stored.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const BUCKET = 'proctoring-evidence'
const MAX_PER_EXAM = 10          // hard cap per student per exam
const MAX_BYTES = 512_000        // ~0.5MB safety ceiling per image

const SEVERE_TYPES = new Set([
  'suspicious_activity', 'multiple_faces', 'face_not_detected',
  'tab_switch', 'fullscreen_exit',
])

// POST /api/proctor/evidence  { examId, type, imageBase64 }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { examId?: string; type?: string; imageBase64?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { examId, type, imageBase64 } = body
  if (!examId || !type || !imageBase64) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (!SEVERE_TYPES.has(type)) {
    // Evidence is only for severe events — silently ignore anything else.
    return NextResponse.json({ stored: false, reason: 'not_severe' })
  }
  if (imageBase64.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Image too large' }, { status: 413 })
  }

  const admin = adminClient()

  // Exam must be published + proctored.
  const { data: exam } = await admin
    .from('exams').select('id, group_id, proctoring_enabled')
    .eq('id', examId).eq('is_published', true).single()
  if (!exam?.proctoring_enabled) {
    return NextResponse.json({ stored: false, reason: 'not_proctored' })
  }

  // Student must be enrolled.
  const { data: enrollment } = await supabase
    .from('group_students').select('student_id')
    .eq('group_id', exam.group_id).eq('student_id', user.id).single()
  if (!enrollment) return NextResponse.json({ error: 'Not enrolled' }, { status: 403 })

  // Enforce the per-exam cap on the SERVER (source of truth). Path layout:
  //   proctoring-evidence/<examId>/<studentId>/<ts>-<type>.jpg
  const prefix = `${examId}/${user.id}`
  const { data: existing } = await admin.storage.from(BUCKET).list(prefix, { limit: MAX_PER_EXAM + 1 })
  if ((existing?.length ?? 0) >= MAX_PER_EXAM) {
    return NextResponse.json({ stored: false, reason: 'limit_reached' })
  }

  // Decode + upload the JPEG.
  const buffer = Buffer.from(imageBase64, 'base64')
  const path = `${prefix}/${Date.now()}-${type}.jpg`
  const { error: upErr } = await admin.storage.from(BUCKET)
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: false })
  if (upErr) {
    console.error('[proctor/evidence] upload', upErr)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  // Link the stored image to a proctoring event (in_progress attempts only).
  await supabase.rpc('append_proctoring_events', {
    p_exam_id: examId,
    p_student_id: user.id,
    p_events: [{
      type,
      timestamp: new Date().toISOString(),
      evidence: true,
      evidence_path: path,
      details: 'Evidence snapshot captured',
    }],
  })

  return NextResponse.json({ stored: true, path })
}
