import type { SupabaseClient } from '@supabase/supabase-js'
import { can } from '@/lib/permissions'
import { getTenantSettings } from '@/lib/structure-mode'
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
  /** From announcement_engagement_migration.sql — absent before it is applied. */
  pinned?: boolean | null
  collect_interest?: boolean | null
  announcement_groups: { group_id: string }[] | null
}

export interface AnnouncementStats { views: number; clicks: number; interest: number }

/**
 * Loads the announcement-management page data for a staff user, and reports
 * whether they actually hold `manage_announcements` (the page renders a
 * permission notice instead of the manager when they don't), plus whether they
 * may address students beyond the centre (`announce_to_university`).
 */
export async function loadAnnouncementsPage(
  supabase: SupabaseClient,
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
  const { data: profile } = await supabase
    .from('users').select('role, permissions').eq('id', userId).single()

  // No centre ⇒ no centre/university split: every author may reach every student.
  const { has_center: hasCenter } = await getTenantSettings(supabase, tenantId)
  const mayTargetUniversity = !hasCenter || canTargetUniversity(profile?.role, profile?.permissions)

  if (!can(profile?.role, profile?.permissions, 'manage_announcements')) {
    return { allowed: false, canTargetUniversity: mayTargetUniversity, hasCenter, announcements: [], groups: [], engagementReady: false }
  }

  // select('*') so the engagement columns come through once they exist,
  // without breaking the page before the migration is applied.
  const [{ data: raw }, { data: groupsRaw }, events] = await Promise.all([
    supabase
      .from('announcements')
      .select('*, announcement_groups(group_id)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('tenant_id', tenantId).order('name'),
    supabase.from('announcement_events').select('announcement_id, kind').eq('tenant_id', tenantId),
  ])

  const engagementReady = !events.error
  const stats = new Map<string, AnnouncementStats>()
  for (const e of (events.data ?? []) as { announcement_id: string; kind: string }[]) {
    const st = stats.get(e.announcement_id) ?? { views: 0, clicks: 0, interest: 0 }
    if (e.kind === 'view') st.views++
    else if (e.kind === 'click') st.clicks++
    else if (e.kind === 'interest') st.interest++
    stats.set(e.announcement_id, st)
  }

  const announcements: AnnouncementRow[] = ((raw ?? []) as unknown as RawAnnouncement[]).map(a => ({
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
    group_ids: (a.announcement_groups ?? []).map(g => g.group_id),
    pinned: a.pinned === true,
    collect_interest: a.collect_interest === true,
    stats: engagementReady ? (stats.get(a.id) ?? { views: 0, clicks: 0, interest: 0 }) : null,
  }))

  // Pinned first, then newest — the order students see them in.
  announcements.sort((a, b) => Number(b.pinned) - Number(a.pinned))

  return {
    allowed: true,
    canTargetUniversity: mayTargetUniversity,
    hasCenter,
    announcements,
    groups: (groupsRaw ?? []) as GroupOption[],
    engagementReady,
  }
}
