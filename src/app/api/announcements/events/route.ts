import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'

// Student engagement with an announcement: a view, a click on its button, or
// "I'm interested" (see supabase/announcement_engagement_migration.sql).
//
// The student may only record an event for an announcement they can actually
// see. Rather than re-implementing the targeting rules here, visibility is
// taken from get_student_announcements() called through the student's own
// session — the same feed their dashboard renders. The write itself goes
// through the service-role client (the table has no write grants).
const KINDS = new Set(['view', 'click', 'interest'])

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface FeedRow { id: string; collect_interest?: boolean }

async function resolve(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }

  let body: { id?: unknown; kind?: unknown }
  try { body = await request.json() } catch { return { error: NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) } }
  const id = typeof body.id === 'string' ? body.id : ''
  const kind = typeof body.kind === 'string' ? body.kind : 'interest'
  if (!id || !KINDS.has(kind)) return { error: NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const limit = await rateLimit(`announcement_event:${user.id}`, { limit: 300, windowSecs: 3600 })
  if (!limit.allowed) return { error: NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 }) }

  const { data: profile } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).single()
  if (profile?.role !== 'student' || !profile.tenant_id) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }

  const { data: feed } = await supabase.rpc('get_student_announcements')
  const row = ((feed ?? []) as FeedRow[]).find(a => a.id === id)
  if (!row) return { error: NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 }) }
  // Interest is only collected where the author asked for it.
  if (kind === 'interest' && row.collect_interest !== true) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  return { userId: user.id, tenantId: profile.tenant_id as string, id, kind }
}

export async function POST(request: Request) {
  const r = await resolve(request)
  if ('error' in r) return r.error
  const { error } = await adminClient()
    .from('announcement_events')
    .upsert(
      { announcement_id: r.id, tenant_id: r.tenantId, student_id: r.userId, kind: r.kind },
      { onConflict: 'announcement_id,student_id,kind', ignoreDuplicates: true },
    )
  if (error) {
    // Before the migration is applied the table does not exist; the banner
    // treats this as "not recorded" and carries on.
    console.error('[announcements/events POST]', error.message)
    return NextResponse.json({ ...(await apiErr('announcementEventFailed')) }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}

/** Withdraw "I'm interested". Views and clicks are never deleted by the student. */
export async function DELETE(request: Request) {
  const r = await resolve(request)
  if ('error' in r) return r.error
  if (r.kind !== 'interest') return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  const { error } = await adminClient()
    .from('announcement_events')
    .delete()
    .eq('announcement_id', r.id).eq('student_id', r.userId).eq('kind', 'interest')
  if (error) {
    console.error('[announcements/events DELETE]', error.message)
    return NextResponse.json({ ...(await apiErr('announcementEventFailed')) }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
