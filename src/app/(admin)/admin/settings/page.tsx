export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdminSettingsClient } from './settings-client'
import { PreferencesCard } from '@/components/shared/preferences-card'

export default async function AdminSettingsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', profile?.tenant_id ?? '')
    .single()

  return (
    <div className="space-y-8">
      <PreferencesCard />
      <AdminSettingsClient tenant={tenant} />
    </div>
  )
}
