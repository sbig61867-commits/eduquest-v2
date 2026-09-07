export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AnnouncementsManager } from '@/components/announcements/announcements-manager'
import { loadAnnouncementsPage } from '@/lib/announcements-data'
import { ShieldAlert } from 'lucide-react'

export default async function AdminAnnouncementsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { allowed, announcements, groups } = await loadAnnouncementsPage(supabase, user.id, user.tenant_id)

  if (!allowed) {
    return (
      <div className="text-center py-20 bg-surface border border-border rounded-lg" dir="rtl">
        <ShieldAlert className="w-12 h-12 text-fg-muted mx-auto mb-3" />
        <p className="text-fg-secondary">لا تملك صلاحية إدارة الإعلانات.</p>
        <p className="text-fg-muted text-sm mt-1">يمكن لمالك المنصة تفعيل هذه الصلاحية لحسابك.</p>
      </div>
    )
  }

  return <AnnouncementsManager announcements={announcements} groups={groups} />
}
