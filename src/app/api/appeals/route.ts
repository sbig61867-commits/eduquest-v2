import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'

// Student-filed disputes over a recorded proctoring violation, directed to
// the exam's teacher. See supabase/exam_appeals_migration.sql for the full
// design rationale (denormalized snapshots, one-appeal-per-event).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ProctoringEventLike { type?: string; timestamp?: string }

// POST /api/appeals — a student disputes a recorded violation (or the exam's
// flagged status generally, if violation_type/violation_at are omitted).
// Body: { submissionId, violationType?, violationAt?, message }
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (ctx.role !== 'student' || !ctx.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const rl = await rateLimit(`appeal:${user.id}`, { limit: 20, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })
  }

  let body: { submissionId?: string; violationType?: string; violationAt?: string; message?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { submissionId, violationType, violationAt } = body
  const message = body.message?.trim()
  if (!submissionId) return NextResponse.json({ ...(await apiErr('submissionIdRequired')) }, { status: 400 })
  if (!message || message.length < 5) {
    return NextResponse.json({ ...(await apiErr('appealTooShort')) }, { status: 400 })
  }
  if (message.length > 2000) {
    return NextResponse.json({ ...(await apiErr('textTooLong')) }, { status: 400 })
  }
  if (!UUID.test(submissionId)) return NextResponse.json({ ...(await apiErr('submissionNotFound')) }, { status: 404 })
  const vType = violationType ?? null
  const vAt = violationAt ?? null
  if (vAt !== null && Number.isNaN(new Date(vAt).getTime())) {
    return NextResponse.json({ ...(await apiErr('violationNotFound')) }, { status: 400 })
  }

  // One unit, as app_service pinned to the student's institution:
  //  1. the submission as it stands (for a precise refusal)
  //  2. the insert, which happens ONLY when the submission is this student's,
  //     the caller is still a live student of the exam's institution, and —
  //     when a specific event is disputed — that event was really recorded on
  //     it (otherwise a student could pollute the teacher's queue and the
  //     admin report). The snapshots (names, title) come in the same statement.
  let rows: Awaited<ReturnType<typeof run>>
  try {
    rows = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
      sql`select s.proctoring_events from public.exam_submissions s where s.id = ${submissionId} and s.student_id = ${user.id}`,
      sql`
        insert into public.exam_appeals (tenant_id, exam_id, submission_id, student_id, teacher_id, group_id,
                                         violation_type, violation_at, student_name, teacher_name, group_name,
                                         exam_title, student_message)
        select e.tenant_id, e.id, s.id, me.id, e.teacher_id, e.group_id, ${vType}, ${vAt}, me.full_name,
               coalesce(t.full_name, '—'), coalesce(g.name, '—'), e.title, ${message}
          from public.exam_submissions s
          join public.exams e on e.id = s.exam_id
          join public.users me on me.id = s.student_id
          left join public.users t on t.id = e.teacher_id
          left join public.groups g on g.id = e.group_id
         where s.id = ${submissionId} and s.student_id = ${user.id}
           and me.role = 'student' and me.is_active is not false and me.tenant_id = e.tenant_id
           and ((${vType}::text is null and ${vAt}::text is null)
                or exists (select 1 from jsonb_array_elements(coalesce(s.proctoring_events, '[]'::jsonb)) ev
                            where ev->>'type' = ${vType}::text and ev->>'timestamp' = ${vAt}::text))
        returning id`,
    ])
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      return NextResponse.json({ ...(await apiErr('appealExists')) }, { status: 409 })
    }
    console.error('[api/appeals POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('appealSendFailed')) }, { status: 500 })
  }

  const created = maybeOne<{ id: string }>(rows[1])
  if (created) return NextResponse.json({ id: created.id }, { status: 201 })

  // Nothing was written: say why.
  const submission = maybeOne<{ proctoring_events: ProctoringEventLike[] | null }>(rows[0])
  if (!submission) return NextResponse.json({ ...(await apiErr('submissionNotFound')) }, { status: 404 })
  const events = submission.proctoring_events ?? []
  if ((vType || vAt) && !events.some(e => e.type === vType && e.timestamp === vAt)) {
    return NextResponse.json({ ...(await apiErr('violationNotFound')) }, { status: 400 })
  }
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}
