import { run } from '@/lib/db/sql'
import { can } from '@/lib/permissions'
import { tenantSettingsSql, toTenantSettings } from '@/lib/structure-mode'
import { canTargetUniversity, type AnnouncementAudience } from '@/lib/announcement-audience'
import type { AnnouncementRow, GroupOption } from '@/components/announcements/announcements-manager'

interface RawAnnouncement {
  id: string
  title: string
  body: string | null
  image_url: string | null
  link_url: string | null
  cta_label: string | null
  audience: AnnouncementAudience
  center_students_only: boolean | null
  is_published: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
  pinned: boolean | null
  collect_interest: boolean | null
  group_ids: string[]
  views: number
  clicks: number
  interest: number
}

export interface AnnouncementStats { views: number; clicks: number; interest: number }

/**
 * Loads the announcement-management page data for a staff user, and reports
 * whether they actually hold `manage_announcements` (the page renders a
 * permission notice instead of the manager when they don't), plus whether they
 * may address students beyond the centre (`announce_to_university`).
 */
export async function loadAnnouncementsPage(
  userId: string,
  tenantId: string,
): Promise<{
  allowed: boolean
  canTargetUniversity: boolean
  hasCenter: boolean
  announcements: AnnouncementRow[]
  groups: GroupOption[]
  /** The engagement migration is applied: pinning, interest and stats are available. */
  engagementReady: boolean
}> {
  // ONE unit read as the caller: profile, settings, the announcements with
  // their groups and engagement counts (counted in the database), and the
  // institution's groups. The capability decides below whether any is shown.
  const [profiles, settingsRows, raw, groupsRaw] = await run({ as: 'user', userId }, sql => {
    return [
      sql`select role, permissions from public.users where id = ${userId}`,
      tenantSettingsSql(sql, tenantId),
      sql`select a.id, a.title, a.body, a.image_url, a.link_url, a.cta_label, a.audience, a.center_students_only,
                 a.is_published, a.starts_at, a.ends_at, a.created_at, a.pinned, a.collect_interest,
                 coalesce((select json_agg(g.group_id) from public.announcement_groups g where g.announcement_id = a.id), '[]') as group_ids,
                 (select count(*) filter (where e.kind = 'view') from public.announcement_events e where e.announcement_id = a.id)::int as views,
                 (select count(*) filter (where e.kind = 'click') from public.announcement_events e where e.announcement_id = a.id)::int as clicks,
                 (select count(*) filter (where e.kind = 'interest') from public.announcement_events e where e.announcement_id = a.id)::int as interest
            from public.announcements a
           where a.tenant_id = ${tenantId}
           order by a.created_at desc limit 500`,
      sql`select id, name from public.groups where tenant_id = ${tenantId} order by name limit 1000`,
    ]
  })
  const profile = profiles[0] as { role: string | null; permissions: Record<string, unknown> | null } | undefined

  // No centre ⇒ no centre/university split: every author may reach every student.
  const { has_center: hasCenter } = toTenantSettings(settingsRows[0])
  const mayTargetUniversity = !hasCenter || canTargetUniversity(profile?.role, profile?.permissions)

  if (!can(profile?.role, profile?.permissions, 'manage_announcements')) {
    return { allowed: false, canTargetUniversity: mayTargetUniversity, hasCenter, announcements: [], groups: [], engagementReady: false }
  }

  const announcements: AnnouncementRow[] = (raw as unknown as RawAnnouncement[]).map(a => ({
    id: a.id,
    title: a.title,
    body: a.body,
    image_url: a.image_url,
    link_url: a.link_url,
    cta_label: a.cta_label,
    audience: a.audience,
    center_students_only: a.center_students_only === true,
    is_published: a.is_published,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    created_at: a.created_at,
    group_ids: a.group_ids,
    pinned: a.pinned === true,
    collect_interest: a.collect_interest === true,
    stats: { views: a.views, clicks: a.clicks, interest: a.interest },
  }))

  // Pinned first, then newest — the order students see them in.
  announcements.sort((a, b) => Number(b.pinned) - Number(a.pinned))

  return {
    allowed: true,
    canTargetUniversity: mayTargetUniversity,
    hasCenter,
    announcements,
    groups: groupsRaw as unknown as GroupOption[],
    engagementReady: true,
  }
}
