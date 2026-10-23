import { ALLOWED_EVENT_TYPES } from '@/lib/proctoring-events'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { onRosterSql } from '@/lib/exam-roster'
import { rateLimit } from '@/lib/rate-limit'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

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

  if (!UUID.test(examId) || !ctx.tenant_id) return NextResponse.json({ ok: true, appended: 0 })
  const service = { as: 'service', tenantId: ctx.tenant_id } as const

  // One unit: the exam must be published and proctored and the student on its
  // roster (students cannot SELECT exams); then the atomic appender
  // (jsonb concat, SECURITY DEFINER), which only writes while the attempt is
  // in progress, so post-submit batches are ignored. The appender is reachable
  // only as app_service (EXECUTE revoked from the user roles), or any user
  // could inject fabricated proctoring events against another student's attempt.
  const [rows] = await run(service, sql => [sql`
    select e.proctoring_enabled, ${onRosterSql(sql, user.id)} as on_roster
      from public.exams e where e.id = ${examId} and e.is_published`])
  const exam = maybeOne<{ proctoring_enabled: boolean | null; on_roster: boolean }>(rows)
  if (!exam?.proctoring_enabled) {
    return NextResponse.json({ ok: true, appended: 0 })
  }
  if (!exam.on_roster) {
    return NextResponse.json({ ...(await apiErr('notEnrolledInExam')) }, { status: 403 })
  }

  let error: unknown = null
  try {
    await run(service, sql => [sql`select public.append_proctoring_events(${examId}, ${user.id}, ${sql.json(clean)})`])
  } catch (e) { error = e }
  if (error) {
    console.error('[proctor/events]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ...(await apiErr('eventsFailed')) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, appended: clean.length })
}
