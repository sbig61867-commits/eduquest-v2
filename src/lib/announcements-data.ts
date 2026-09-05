import type { SupabaseClient } from '@supabase/supabase-js'
import { can } from '@/lib/permissions'
import type { AnnouncementRow, GroupOption } from '@/components/announcements/announcements-manager'

interface RawAnnouncement {
  id: string
  title: string
  body: string | null
  image_url: string | null
  link_url: string | null
  cta_label: string | null
  audience: 'all' | 'groups'
  is_published: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
  announcement_groups: { group_id: string }[] | null
}

/**
 * Loads the announcement-management page data for a staff user, and reports
 * whether they actually hold `manage_announcements` (the page renders a
 * permission notice instead of the manager when they don't).
 */
export async function loadAnnouncementsPage(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<{ allowed: boolean; announcements: AnnouncementRow[]; groups: GroupOption[] }> {
  const { data: profile } = await supabase
    .from('users').select('role, permissions').eq('id', userId).single()

  if (!can(profile?.role, profile?.permissions, 'manage_announcements')) {
    return { allowed: false, announcements: [], groups: [] }
  }

  const [{ data: raw }, { data: groupsRaw }] = await Promise.all([
    supabase
      .from('announcements')
      .select(`
        id, title, body, image_url, link_url, cta_label, audience,
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
    is_published: a.is_published,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    created_at: a.created_at,
    group_ids: (a.announcement_groups ?? []).map(g => g.group_id),
  }))

  return { allowed: true, announcements, groups: (groupsRaw ?? []) as GroupOption[] }
}
