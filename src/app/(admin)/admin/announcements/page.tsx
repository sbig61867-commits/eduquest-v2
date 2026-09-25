export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AnnouncementsManager } from '@/components/announcements/announcements-manager'
import { loadAnnouncementsPage } from '@/lib/announcements-data'
import { NoPermission } from '@/components/shared/no-permission'

export default async function AdminAnnouncementsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { allowed, canTargetUniversity, hasCenter, announcements, groups } =
    await loadAnnouncementsPage(supabase, user.id, user.tenant_id)

  if (!allowed) return <NoPermission capability="manage_announcements" />

  return (
    <AnnouncementsManager
      announcements={announcements}
      groups={groups}
      canTargetUniversity={canTargetUniversity}
      hasCenter={hasCenter}
    />
  )
}
