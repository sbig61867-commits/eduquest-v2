export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PageTitle } from '@/components/shared/page-title'
import { SchedulesManager } from '@/components/schedules/schedules-manager'
import { loadSchedulesPage } from '@/lib/schedules-data'
import { ShieldAlert } from 'lucide-react'

export default async function CenterSchedulesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { allowed, schedules, targets } = await loadSchedulesPage(supabase, user.id, user.tenant_id)

  if (!allowed) {
    return (
      <div className="text-center py-20 bg-surface border border-border rounded-lg" dir="rtl">
        <ShieldAlert className="w-12 h-12 text-fg-muted mx-auto mb-3" />
        <p className="text-fg-secondary">لا تملك صلاحية إدارة جداول المواعيد.</p>
      </div>
    )
  }

  return (<><PageTitle title="Schedules" /><SchedulesManager schedules={schedules} targets={targets} /></>)
}
