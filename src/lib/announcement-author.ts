import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentCtx } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { can, type PermissionMap } from '@/lib/permissions'
import { canTargetUniversity } from '@/lib/announcement-audience'

// Who is writing announcements, and what they write about — read in ONE unit
// as app_service pinned to the caller's institution:
//  - the caller's LIVE row (role, capabilities, active) — the session alone
//    never decides;
//  - whether the institution has a centre (no centre ⇒ one student population,
//    nothing to restrict);
//  - on request, the announcement being edited (only if it is in this
//    institution) and how many of the given groups are this institution's.
// The write that follows runs in the same scope and repeats the live check.

export interface AnnouncementAuthor {
  id: string
  role: string
  tenant_id: string
  permissions: PermissionMap
  /** Holds `announce_to_university` — may reach beyond the centre's students. */
  mayTargetUniversity: boolean
}

export interface ExistingAnnouncement {
  id: string
  audience: string
  center_students_only: boolean | null
  starts_at: string | null
  ends_at: string | null
}

export async function loadAnnouncementAuthor(
  opts: { announcementId?: string; groupIds?: string[] } = {},
): Promise<{ author: AnnouncementAuthor; existing: ExistingAnnouncement | null; validGroups: number } | { error: NextResponse }> {
  const ctx = await currentCtx()
  if (!ctx) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  const forbidden = async () => ({ error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) })
  if (!ctx.tenant_id) return forbidden()
  const tenantId = ctx.tenant_id

  const groupIds = opts.groupIds ?? []
  const rows = await run({ as: 'service', tenantId }, sql => [
    sql`select u.role, u.permissions, t.has_center
          from public.users u join public.tenants t on t.id = u.tenant_id
         where u.id = ${ctx.sub} and u.tenant_id = ${tenantId} and u.is_active is not false`,
    ...(opts.announcementId ? [
      sql`select id, audience, center_students_only, starts_at, ends_at from public.announcements
           where id = ${opts.announcementId} and tenant_id = ${tenantId}`,
    ] : []),
    ...(groupIds.length ? [
      sql`select count(*)::int as n from public.groups
           where tenant_id = ${tenantId} and id in (select (jsonb_array_elements_text(${sql.json(groupIds)}))::uuid)`,
    ] : []),
  ])
  const me = maybeOne<{ role: string; permissions: PermissionMap; has_center: boolean | null }>(rows[0])
  if (!me || !can(me.role, me.permissions, 'manage_announcements')) return forbidden()
  let i = 1
  const existing = opts.announcementId ? maybeOne<ExistingAnnouncement>(rows[i++]) : null
  const validGroups = groupIds.length ? (maybeOne<{ n: number }>(rows[i])?.n ?? 0) : 0
  return {
    author: {
      id: ctx.sub,
      role: me.role,
      tenant_id: tenantId,
      permissions: me.permissions,
      mayTargetUniversity: me.has_center === false || canTargetUniversity(me.role, me.permissions),
    },
    existing,
    validGroups,
  }
}
