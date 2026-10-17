export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdminSettingsClient } from './settings-client'
import { AccountSettings } from '@/components/shared/account-settings'

type TenantRow = { id: string; name: string; slug: string; logo_url: string | null; is_active: boolean; created_at: string }

export default async function AdminSettingsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // One round trip: the admin's institution through the users → tenants FK,
  // only the columns the institution card shows.
  const { data: profile } = await supabase
    .from('users')
    .select('tenant:tenants(id, name, slug, logo_url, is_active, created_at)')
    .eq('id', user.id)
    .single()
  const raw = (profile as unknown as { tenant: TenantRow | TenantRow[] | null } | null)?.tenant ?? null
  const tenant = Array.isArray(raw) ? raw[0] ?? null : raw

  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <AccountSettings />
      </div>
      <AdminSettingsClient tenant={tenant} />
    </div>
  )
}
