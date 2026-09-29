import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import {
  EVIDENCE_MAX_BYTES, EVIDENCE_MAX_PER_STUDENT,
  evidenceKey, evidenceKeysFromEvents, expiresAt, extOf, isClipExt, sniffEvidenceImage,
} from '@/lib/evidence-keys'
import { isEvidenceStoreConfigured, putEvidence } from '@/lib/evidence-store'
import { verifySecondCameraToken } from '@/lib/second-camera-token'

// POST /api/proctor/second-camera/event
//   { token, kind: 'connected' }                                   — once, when the phone's camera starts
//   { token, kind: 'violation', type, details?, imageBase64? }     — the phone's own detector saw something
//
// The phone has no session: the signed token (src/lib/second-camera-token.ts)
// names the exam and the student, and only a RUNNING attempt accepts events.
// Side-view violations reuse the ordinary types, marked "side camera" in
// their details. A snapshot follows the snapshot policy (external store,
// never Supabase, 30 h, shared cap). Public in src/proxy.ts. NO AI.

const SIDE_TYPES = new Set(['suspicious_activity', 'multiple_faces'])

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  let body: { token?: unknown; kind?: unknown; type?: unknown; details?: unknown; imageBase64?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const claim = verifySecondCameraToken(typeof body.token === 'string' ? body.token : null)
  if (!claim) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const { examId, studentId } = claim

  const kind = body.kind
  if (kind !== 'connected' && kind !== 'violation') return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  if (kind === 'violation' && !(typeof body.type === 'string' && SIDE_TYPES.has(body.type))) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  const limit = await rateLimit(`second-camera:${studentId}`, { limit: 30, windowSecs: 600 })
  if (!limit.allowed) return NextResponse.json({ stored: false, reason: 'rate_limited' })

  const admin = adminClient()
  const { data: attempt } = await admin
    .from('exam_submissions').select('status, proctoring_events')
    .eq('exam_id', examId).eq('student_id', studentId).maybeSingle()
  if (attempt?.status !== 'in_progress') return NextResponse.json({ stored: false, reason: 'not_in_progress' })

  const now = Date.now()
  if (kind === 'connected') {
    await admin.rpc('append_proctoring_events', {
      p_exam_id: examId, p_student_id: studentId,
      p_events: [{ type: 'second_camera_connected', timestamp: new Date(now).toISOString(), details: 'phone side camera connected' }],
    })
    return NextResponse.json({ stored: true })
  }

  const type = body.type as 'suspicious_activity' | 'multiple_faces'
  const details = `side camera: ${typeof body.details === 'string' ? body.details.slice(0, 120) : type}`
  const event: Record<string, unknown> = { type, timestamp: new Date(now).toISOString(), details }

  // Optional snapshot, under the ordinary snapshot policy and cap.
  if (typeof body.imageBase64 === 'string' && body.imageBase64 && isEvidenceStoreConfigured()) {
    const snapshots = evidenceKeysFromEvents(attempt.proctoring_events).filter(k => !isClipExt(extOf(k.key)))
    if (body.imageBase64.length <= Math.ceil(EVIDENCE_MAX_BYTES * 4 / 3) + 4 && snapshots.length < EVIDENCE_MAX_PER_STUDENT) {
      let bytes: Uint8Array | null = null
      try { bytes = new Uint8Array(Buffer.from(body.imageBase64, 'base64')) } catch { bytes = null }
      const ext = bytes ? sniffEvidenceImage(bytes) : null
      if (bytes && ext && bytes.length <= EVIDENCE_MAX_BYTES) {
        const key = evidenceKey(examId, studentId, type, now, ext)
        if (await putEvidence(key, bytes, ext, expiresAt(now))) {
          Object.assign(event, { evidence: true, evidence_key: key, evidence_expires_at: new Date(expiresAt(now)).toISOString() })
        }
      }
    }
  }

  await admin.rpc('append_proctoring_events', { p_exam_id: examId, p_student_id: studentId, p_events: [event] })
  return NextResponse.json({ stored: true })
}
