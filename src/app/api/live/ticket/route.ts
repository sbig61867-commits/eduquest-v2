import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { isLiveTopic, signLiveTicket, type LiveRole } from '@/lib/live-ticket'

// GET /api/live/ticket?topic=exam-live:<exam>|exam-thumbs:<exam> — a short-lived
// ticket to join an exam's live channel (step 13, src/lib/live-ticket.ts). Who
// may join is decided exactly as by the old Realtime policy: the database
// function exam_topic_role(), read as the caller — the exam's own teacher
// (proctored, not deleted) or a student with an attempt in progress.
export async function GET(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const topic = new URL(request.url).searchParams.get('topic')
  if (!isLiveTopic(topic)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    const [rows] = await run({ as: 'user', userId: user.id }, sql => [sql`select public.exam_topic_role(${topic}) as role`])
    const role = maybeOne<{ role: LiveRole | null }>(rows)?.role ?? null
    if (role !== 'teacher' && role !== 'student') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    const ticket = await signLiveTicket(process.env.LIVE_SIGNING_SECRET, { topic, userId: user.id, role })
    return NextResponse.json({ ticket, role }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[live/ticket]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
