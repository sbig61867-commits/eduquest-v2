import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { isOnExamRoster } from '@/lib/exam-roster'
import { rateLimit } from '@/lib/rate-limit'
import {
  EVIDENCE_MAX_BYTES, EVIDENCE_MAX_PER_STUDENT, EVIDENCE_TTL_HOURS,
  evidenceKey, evidenceKeysFromEvents, expiresAt, isEvidenceType, isExpired, isUuid, linkSeconds,
  sniffEvidenceImage,
} from '@/lib/evidence-keys'
import { evidenceViewUrl, isEvidenceStoreConfigured, putEvidence } from '@/lib/evidence-store'

// Proctoring evidence snapshots (policy: src/lib/evidence-keys.ts).
//   POST — the student's browser sends ONE small snapshot for a SEVERE violation.
//          It goes to the external evidence store (Workers KV / R2), never to
//          Supabase; only a short event line (with the key) is appended to the
//          attempt. That event log is also the index of what exists.
//   GET  — the exam's own teacher lists the snapshots of the last 30 hours.
// NO AI — images are never analysed by any model.

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/proctor/evidence  { examId, type, imageBase64 }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { examId?: unknown; type?: unknown; imageBase64?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { examId, type, imageBase64 } = body
  if (!isUuid(examId) || typeof imageBase64 !== 'string' || !imageBase64) {
    return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
  }
  // Evidence is only for severe events — silently ignore anything else.
  if (!isEvidenceType(type)) return NextResponse.json({ stored: false, reason: 'not_severe' })
  // No external store configured → evidence capture is off. Never fall back to Supabase.
  if (!isEvidenceStoreConfigured()) return NextResponse.json({ stored: false, reason: 'store_unconfigured' })

  // base64 is ~4/3 of the bytes; reject before decoding anything oversized.
  if (imageBase64.length > Math.ceil(EVIDENCE_MAX_BYTES * 4 / 3) + 8) {
    return NextResponse.json({ ...(await apiErr('imageTooLarge')) }, { status: 413 })
  }
  const bytes = new Uint8Array(Buffer.from(imageBase64, 'base64'))
  const ext = sniffEvidenceImage(bytes)
  if (!ext || bytes.length > EVIDENCE_MAX_BYTES) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  const limit = await rateLimit(`evidence:${user.id}`, { limit: 30, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ stored: false, reason: 'rate_limited' })

  const admin = adminClient()

  // Exam must be published + proctored, and the student on its roster.
  const { data: exam } = await admin.from('exams').select('*').eq('id', examId).eq('is_published', true).single()
  if (!exam?.proctoring_enabled) return NextResponse.json({ stored: false, reason: 'not_proctored' })
  if (!(await isOnExamRoster(supabase, exam, user.id))) {
    return NextResponse.json({ ...(await apiErr('notEnrolled')) }, { status: 403 })
  }

  // Only a running attempt may add evidence, capped per student per exam.
  const { data: attempt } = await admin
    .from('exam_submissions').select('status, proctoring_events')
    .eq('exam_id', examId).eq('student_id', user.id).maybeSingle()
  if (!attempt || attempt.status !== 'in_progress') return NextResponse.json({ stored: false, reason: 'not_in_progress' })
  if (evidenceKeysFromEvents(attempt.proctoring_events).length >= EVIDENCE_MAX_PER_STUDENT) {
    return NextResponse.json({ stored: false, reason: 'limit_reached' })
  }

  const capturedAt = Date.now()
  const key = evidenceKey(examId, user.id, type, capturedAt, ext)
  if (!(await putEvidence(key, bytes, ext, expiresAt(capturedAt)))) {
    return NextResponse.json({ ...(await apiErr('uploadFailed')) }, { status: 502 })
  }

  // Only a short text line reaches the database — never the image.
  await admin.rpc('append_proctoring_events', {
    p_exam_id: examId,
    p_student_id: user.id,
    p_events: [{
      type,
      timestamp: new Date(capturedAt).toISOString(),
      evidence: true,
      evidence_key: key,
      evidence_expires_at: new Date(expiresAt(capturedAt)).toISOString(),
      details: 'Evidence snapshot captured',
    }],
  })

  return NextResponse.json({ stored: true })
}

export interface EvidenceItem {
  studentId: string
  studentName: string
  type: string
  capturedAt: string
  expiresAt: string
  url: string
}

// GET /api/proctor/evidence?examId=…  → the exam teacher's live snapshot feed
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const examId = new URL(request.url).searchParams.get('examId')
  if (!isUuid(examId)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })

  // Only the exam's own teacher (read through the user session: RLS applies too).
  const { data: exam } = await supabase.from('exams').select('id, teacher_id').eq('id', examId).maybeSingle()
  if (!exam || exam.teacher_id !== user.id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  if (!isEvidenceStoreConfigured()) {
    return NextResponse.json({ configured: false, ttlHours: EVIDENCE_TTL_HOURS, items: [] })
  }

  // The attempts' own event logs are the index (the teacher may read their exams' submissions).
  const { data: attempts } = await supabase
    .from('exam_submissions').select('student_id, proctoring_events').eq('exam_id', examId)

  const now = Date.now()
  const live = (attempts ?? [])
    .flatMap(a => evidenceKeysFromEvents(a.proctoring_events).filter(k => k.studentId === a.student_id && k.examId === examId))
    .filter(k => !isExpired(k.capturedAt, now))
    .sort((a, b) => b.capturedAt - a.capturedAt)

  const ids = [...new Set(live.map(k => k.studentId))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: students } = await supabase.from('users').select('id, full_name').in('id', ids)
    for (const s of students ?? []) names.set(s.id, s.full_name ?? '')
  }

  const items: EvidenceItem[] = []
  for (const k of live) {
    const url = await evidenceViewUrl(k.key, linkSeconds(k.capturedAt, now))
    if (!url) continue
    items.push({
      studentId: k.studentId,
      studentName: names.get(k.studentId) ?? '',
      type: k.type,
      capturedAt: new Date(k.capturedAt).toISOString(),
      expiresAt: new Date(expiresAt(k.capturedAt)).toISOString(),
      url,
    })
  }

  return NextResponse.json(
    { configured: true, ttlHours: EVIDENCE_TTL_HOURS, items },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
