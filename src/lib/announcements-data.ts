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
  announcement_groups: { group_id: string }[] | null
}

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
}> {
  const { data: profile } = await supabase
    .from('users').select('role, permissions').eq('id', userId).single()

  // No centre ⇒ no centre/university split: every author may reach every student.
  const { has_center: hasCenter } = await getTenantSettings(supabase, tenantId)
  const mayTargetUniversity = !hasCenter || canTargetUniversity(profile?.role, profile?.permissions)

  if (!can(profile?.role, profile?.permissions, 'manage_announcements')) {
    return { allowed: false, canTargetUniversity: mayTargetUniversity, hasCenter, announcements: [], groups: [] }
  }

  const [{ data: raw }, { data: groupsRaw }] = await Promise.all([
    supabase
      .from('announcements')
      .select(`
        id, title, body, image_url, link_url, cta_label, audience, center_students_only,
        is_published, starts_at, ends_at, created_at,
        announcement_groups(group_id)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase.from('groups').select('id, name').eq('tenant_id', tenantId).order('name'),
  ])

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
  }))

  return {
    allowed: true,
    canTargetUniversity: mayTargetUniversity,
    hasCenter,
    announcements,
    groups: (groupsRaw ?? []) as GroupOption[],
  }
}
