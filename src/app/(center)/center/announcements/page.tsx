export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { redirect } from 'next/navigation'
import { AnnouncementsManager } from '@/components/announcements/announcements-manager'
import { loadAnnouncementsPage } from '@/lib/announcements-data'
import { NoPermission } from '@/components/shared/no-permission'

export default async function CenterAnnouncementsPage() {
  const user = await currentUser()
  if (!user?.tenant_id) redirect('/login')

  const { allowed, canTargetUniversity, hasCenter, announcements, groups, engagementReady } =
    await loadAnnouncementsPage(user.id, user.tenant_id)

  if (!allowed) return <NoPermission capability="manage_announcements" />

  return (
    <AnnouncementsManager
      announcements={announcements}
      groups={groups}
      canTargetUniversity={canTargetUniversity}
      hasCenter={hasCenter}
      engagementReady={engagementReady}
    />
  )
}
