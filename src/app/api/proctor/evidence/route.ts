import { getSessionUser } from '@/lib/auth'
import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { onRosterSql } from '@/lib/exam-roster'
import { rateLimit } from '@/lib/rate-limit'
import {
  EVIDENCE_MAX_BYTES, EVIDENCE_MAX_PER_STUDENT, EVIDENCE_TTL_HOURS,
  evidenceKey, evidenceKeysFromEvents, expiresAt, isEvidenceType, isExpired, isUuid, linkSeconds,
  sniffEvidenceImage, isClipExt, extOf,
} from '@/lib/evidence-keys'
import { evidenceViewUrl, isEvidenceStoreConfigured, putEvidence } from '@/lib/evidence-store'

// Proctoring evidence snapshots (policy: src/lib/evidence-keys.ts).
//   POST — the student's browser sends ONE small snapshot for a SEVERE violation.
//          It goes to the external evidence store (Workers KV / R2), never to
//          Supabase; only a short event line (with the key) is appended to the
//          attempt. That event log is also the index of what exists.
//   GET  — the exam's own teacher lists the snapshots of the last 30 hours.
// NO AI — images are never analysed by any model.


// POST /api/proctor/evidence  { examId, type, imageBase64 }
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

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

  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('notEnrolled')) }, { status: 403 })
  const service = { as: 'service', tenantId: ctx.tenant_id } as const

  // One unit, as app_service pinned to the student's institution: the exam
  // (published and proctored), the roster check and the student's attempt.
  const [examRows, attemptRows] = await run(service, sql => [
    sql`select e.proctoring_enabled, ${onRosterSql(sql, user.id)} as on_roster from public.exams e where e.id = ${examId} and e.is_published`,
    sql`select status, proctoring_events from public.exam_submissions where exam_id = ${examId} and student_id = ${user.id}`,
  ])
  const exam = maybeOne<{ proctoring_enabled: boolean | null; on_roster: boolean }>(examRows)
  if (!exam?.proctoring_enabled) return NextResponse.json({ stored: false, reason: 'not_proctored' })
  if (!exam.on_roster) {
    return NextResponse.json({ ...(await apiErr('notEnrolled')) }, { status: 403 })
  }

  const attempt = maybeOne<{ status: string; proctoring_events: unknown }>(attemptRows)
  if (!attempt || attempt.status !== 'in_progress') return NextResponse.json({ stored: false, reason: 'not_in_progress' })
  if (evidenceKeysFromEvents(attempt.proctoring_events).filter(k => !isClipExt(extOf(k.key))).length >= EVIDENCE_MAX_PER_STUDENT) {
    return NextResponse.json({ stored: false, reason: 'limit_reached' })
  }

  const capturedAt = Date.now()
  const key = evidenceKey(examId, user.id, type, capturedAt, ext)
  if (!(await putEvidence(key, bytes, ext, expiresAt(capturedAt)))) {
    return NextResponse.json({ ...(await apiErr('uploadFailed')) }, { status: 502 })
  }

  // Only a short text line reaches the database — never the image.
  const events = [{
    type,
    timestamp: new Date(capturedAt).toISOString(),
    evidence: true,
    evidence_key: key,
    evidence_expires_at: new Date(expiresAt(capturedAt)).toISOString(),
    details: 'Evidence snapshot captured',
  }]
  await run(service, sql => [sql`select public.append_proctoring_events(${examId}, ${user.id}, ${sql.json(events)})`])

  return NextResponse.json({ stored: true })
}

export interface EvidenceItem {
  studentId: string
  studentName: string
  type: string
  capturedAt: string
  expiresAt: string
  url: string
  /** A snapshot, or a short video clip (src/lib/evidence-keys.ts). */
  media: 'image' | 'video'
}

// GET /api/proctor/evidence?examId=…  → the exam teacher's live snapshot feed
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const examId = new URL(request.url).searchParams.get('examId')
  if (!isUuid(examId)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })

  if (!isEvidenceStoreConfigured()) {
    return NextResponse.json({ configured: false, ttlHours: EVIDENCE_TTL_HOURS, items: [] })
  }

  // One unit, read as the teacher: RLS lets them see only their own exams'
  // submissions and their institution's students. The names come with the
  // attempts (one join) instead of a second, batched read.
  let examRow: { teacher_id: string } | null
  let attempts: { student_id: string; proctoring_events: unknown; full_name: string | null }[]
  try {
    const [e, a] = await run({ as: 'user', userId: user.id }, sql => [
      sql`select teacher_id from public.exams where id = ${examId}`,
      sql`select s.student_id, s.proctoring_events, u.full_name
            from public.exam_submissions s left join public.users u on u.id = s.student_id
           where s.exam_id = ${examId}`,
    ])
    examRow = maybeOne<{ teacher_id: string }>(e)
    attempts = a as unknown as typeof attempts
  } catch (e) {
    console.error('[proctor/evidence]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('dataReadIncomplete')) }, { status: 503 })
  }
  if (!examRow || examRow.teacher_id !== user.id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const now = Date.now()
  const names = new Map(attempts.map(a => [a.student_id, a.full_name ?? '']))
  const live = attempts
    // a key is trusted only inside its own student's row and for this exam
    .flatMap(a => evidenceKeysFromEvents(a.proctoring_events).filter(k => k.studentId === a.student_id && k.examId === examId))
    .filter(k => !isExpired(k.capturedAt, now))
    .sort((a, b) => b.capturedAt - a.capturedAt)

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
      media: isClipExt(extOf(k.key)) ? 'video' : 'image',
    })
  }

  return NextResponse.json(
    { configured: true, ttlHours: EVIDENCE_TTL_HOURS, items },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
