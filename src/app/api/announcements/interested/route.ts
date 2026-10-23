import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { can, type PermissionMap } from '@/lib/permissions'
import { canEditAnnouncement, canTargetUniversity, AUDIENCE_DENIED } from '@/lib/announcement-audience'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIST_LIMIT = 5000

// GET /api/announcements/interested?id=… — the students who pressed
// "I'm interested" on one announcement, for its authors. Same gate as editing
// the announcement: `manage_announcements`, same tenant, and an author pinned
// to the centre cannot read an announcement that reaches university students.
// One unit, read as the caller: announcement_events' SELECT policy already
// limits staff to their own tenant, and users are tenant-readable for staff.
// The names come with the events in one join (no batched second read).
export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 })

  let me: { role: string; permissions: PermissionMap; has_center: boolean | null } | null
  let ann: { audience: string; center_students_only: boolean | null } | null
  let events: { student_id: string; created_at: string; full_name: string | null; email: string | null }[]
  try {
    const rows = await run({ as: 'user', userId: ctx.sub }, sql => [
      sql`select u.role, u.permissions, t.has_center
            from public.users u join public.tenants t on t.id = u.tenant_id
           where u.id = ${ctx.sub} and u.tenant_id = ${tenantId} and u.is_active is not false`,
      sql`select audience, center_students_only from public.announcements where id = ${id} and tenant_id = ${tenantId}`,
      sql`select e.student_id, e.created_at, u.full_name, u.email
            from public.announcement_events e
            left join public.users u on u.id = e.student_id and u.tenant_id = ${tenantId}
           where e.announcement_id = ${id} and e.tenant_id = ${tenantId} and e.kind = 'interest'
           order by e.created_at desc
           limit ${LIST_LIMIT}`,
    ])
    me = maybeOne(rows[0])
    ann = maybeOne(rows[1])
    events = rows[2] as unknown as typeof events
  } catch (e) {
    console.error('[announcements/interested]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('announcementEventFailed')) }, { status: 503 })
  }

  if (!me || !can(me.role, me.permissions, 'manage_announcements')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (!ann) return NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 })
  const mayTargetUniversity = me.has_center === false || canTargetUniversity(me.role, me.permissions)
  if (!canEditAnnouncement(ann, mayTargetUniversity)) {
    return NextResponse.json({ ...(await apiErr(AUDIENCE_DENIED)) }, { status: 403 })
  }

  return NextResponse.json({
    students: events.map(e => ({ id: e.student_id, full_name: e.full_name ?? '', email: e.email ?? '', at: e.created_at })),
  })
}
