export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SchedulesManager } from '@/components/schedules/schedules-manager'
import { loadSchedulesPage } from '@/lib/schedules-data'
import { NoPermission } from '@/components/shared/no-permission'

export default async function CenterSchedulesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { allowed, schedules, targets } = await loadSchedulesPage(supabase, user.id, user.tenant_id)

  if (!allowed) return <NoPermission capability="manage_schedules" />

  return <SchedulesManager schedules={schedules} targets={targets} />
}
