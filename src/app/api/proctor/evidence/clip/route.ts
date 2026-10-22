import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminDb } from '@/lib/db'
import { isOnExamRoster } from '@/lib/exam-roster'
import { rateLimit } from '@/lib/rate-limit'
import {
  CLIP_MAX_BYTES, CLIP_MAX_PER_STUDENT, ON_REQUEST, ROOM_SCAN,
  evidenceKey, evidenceKeysFromEvents, expiresAt, extOf, isClipExt, isEvidenceType, isUuid, sniffEvidenceVideo,
  type EvidenceType,
} from '@/lib/evidence-keys'
import { isEvidenceStoreConfigured, putEvidence } from '@/lib/evidence-store'

// POST /api/proctor/evidence/clip?examId=…&type=…   body: the clip bytes
//
// One short evidence clip (≈10 s of the student's own camera + microphone,
// recorded in memory on the device — src/hooks/use-clip-recorder.ts), sent
// for a severe violation or because the exam's teacher asked for the last
// 30 seconds. Same policy as snapshots (src/lib/evidence-keys.ts): external
// store only, never Supabase; teacher-only; deleted after 30 hours. Only a
// short event line with the key reaches the attempt. NO AI.

function adminClient() {
  return getAdminDb()
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const params = new URL(request.url).searchParams
  const examId = params.get('examId')
  const rawType = params.get('type')
  if (!isUuid(examId)) return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
  const type: EvidenceType | null =
    rawType === ON_REQUEST ? ON_REQUEST : rawType === ROOM_SCAN ? ROOM_SCAN : isEvidenceType(rawType) ? rawType : null
  if (!type) return NextResponse.json({ stored: false, reason: 'not_severe' })
  if (!isEvidenceStoreConfigured()) return NextResponse.json({ stored: false, reason: 'store_unconfigured' })

  // Refuse oversized bodies before reading them.
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > CLIP_MAX_BYTES) return NextResponse.json({ ...(await apiErr('imageTooLarge')) }, { status: 413 })
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length === 0 || bytes.length > CLIP_MAX_BYTES) {
    return NextResponse.json({ ...(await apiErr('imageTooLarge')) }, { status: 413 })
  }
  const ext = sniffEvidenceVideo(bytes)
  if (!ext) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })

  const limit = await rateLimit(`evidence-clip:${user.id}`, { limit: 12, windowSecs: 600 })
  if (!limit.allowed) return NextResponse.json({ stored: false, reason: 'rate_limited' })

  const admin = adminClient()
  const { data: exam } = await admin.from('exams').select('*').eq('id', examId).eq('is_published', true).single()
  if (!exam?.proctoring_enabled) return NextResponse.json({ stored: false, reason: 'not_proctored' })
  if (!(await isOnExamRoster(supabase, exam, user.id))) {
    return NextResponse.json({ ...(await apiErr('notEnrolled')) }, { status: 403 })
  }

  const { data: attempt } = await admin
    .from('exam_submissions').select('status, proctoring_events')
    .eq('exam_id', examId).eq('student_id', user.id).maybeSingle()
  if (!attempt || attempt.status !== 'in_progress') return NextResponse.json({ stored: false, reason: 'not_in_progress' })
  const clips = evidenceKeysFromEvents(attempt.proctoring_events).filter(k => isClipExt(extOf(k.key)))
  if (clips.length >= CLIP_MAX_PER_STUDENT) return NextResponse.json({ stored: false, reason: 'limit_reached' })
  // One room scan per attempt.
  if (type === ROOM_SCAN && clips.some(k => k.type === ROOM_SCAN)) return NextResponse.json({ stored: false, reason: 'limit_reached' })

  const capturedAt = Date.now()
  const key = evidenceKey(examId, user.id, type, capturedAt, ext)
  if (!(await putEvidence(key, bytes, ext, expiresAt(capturedAt)))) {
    return NextResponse.json({ ...(await apiErr('uploadFailed')) }, { status: 502 })
  }

  // Only a short text line reaches the database — never the video.
  await admin.rpc('append_proctoring_events', {
    p_exam_id: examId,
    p_student_id: user.id,
    p_events: [{
      // A teacher-requested clip and the room scan are not violations: info.
      type: type === ON_REQUEST ? 'clip_requested' : type,
      timestamp: new Date(capturedAt).toISOString(),
      evidence: true,
      evidence_key: key,
      evidence_expires_at: new Date(expiresAt(capturedAt)).toISOString(),
      details: type === ON_REQUEST ? 'Clip requested by the teacher' : type === ROOM_SCAN ? 'Room scan at the start' : 'Evidence clip captured',
    }],
  })

  return NextResponse.json({ stored: true })
}
