import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'

// Student engagement with an announcement: a view, a click on its button, or
// "I'm interested" (see supabase/announcement_engagement_migration.sql).
//
// The student may only record an event for an announcement they can actually
// see. Rather than re-implementing the targeting rules here, visibility is
// taken from get_student_announcements() read as the student — the same feed
// their dashboard renders. The write itself runs as app_service pinned to the
// student's institution (the table has no write grants for users).
const KINDS = new Set(['view', 'click', 'interest'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolve(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }

  let body: { id?: unknown; kind?: unknown }
  try { body = await request.json() } catch { return { error: NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) } }
  const id = typeof body.id === 'string' ? body.id : ''
  const kind = typeof body.kind === 'string' ? body.kind : 'interest'
  if (!id || !KINDS.has(kind)) return { error: NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const limit = await rateLimit(`announcement_event:${ctx.sub}`, { limit: 300, windowSecs: 3600 })
  if (!limit.allowed) return { error: NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 }) }

  if (ctx.role !== 'student' || !ctx.tenant_id) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  if (!UUID.test(id)) return { error: NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 }) }

  // One unit, as the student: their live row and the announcement from their own feed.
  const [me, feed] = await run({ as: 'user', userId: ctx.sub }, sql => [
    sql`select tenant_id from public.users where id = ${ctx.sub} and role = 'student' and is_active is not false`,
    sql`select id, collect_interest from public.get_student_announcements() where id = ${id}`,
  ])
  const student = maybeOne<{ tenant_id: string | null }>(me)
  if (!student?.tenant_id) return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  const row = (feed as unknown as { id: string; collect_interest?: boolean }[])[0]
  if (!row) return { error: NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 }) }
  // Interest is only collected where the author asked for it.
  if (kind === 'interest' && row.collect_interest !== true) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  return { userId: ctx.sub, tenantId: student.tenant_id, id, kind }
}

export async function POST(request: Request) {
  const r = await resolve(request)
  if ('error' in r) return r.error
  try {
    await run({ as: 'service', tenantId: r.tenantId }, sql => [
      sql`insert into public.announcement_events (announcement_id, tenant_id, student_id, kind)
          values (${r.id}, ${r.tenantId}, ${r.userId}, ${r.kind})
          on conflict (announcement_id, student_id, kind) do nothing`,
    ])
  } catch (e) {
    console.error('[announcements/events POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('announcementEventFailed')) }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}

/** Withdraw "I'm interested". Views and clicks are never deleted by the student. */
export async function DELETE(request: Request) {
  const r = await resolve(request)
  if ('error' in r) return r.error
  if (r.kind !== 'interest') return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    await run({ as: 'service', tenantId: r.tenantId }, sql => [
      sql`delete from public.announcement_events
           where announcement_id = ${r.id} and student_id = ${r.userId} and kind = 'interest'`,
    ])
  } catch (e) {
    console.error('[announcements/events DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('announcementEventFailed')) }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
