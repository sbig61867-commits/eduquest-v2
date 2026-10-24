export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { AdminSettingsClient } from './settings-client'
import { AccountSettings } from '@/components/shared/account-settings'

type TenantRow = { id: string; name: string; slug: string; logo_url: string | null; default_locale: string | null; is_active: boolean; created_at: string }

export default async function AdminSettingsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  // One statement as the admin: their institution through users → tenants,
  // only the columns the institution card shows.
  const [rows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select t.id, t.name, t.slug, t.logo_url, t.default_locale, t.is_active, t.created_at
          from public.users u join public.tenants t on t.id = u.tenant_id where u.id = ${user.id}`,
  ])
  const tenant = (rows[0] as unknown as TenantRow | undefined) ?? null

  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <AccountSettings />
      </div>
      <AdminSettingsClient tenant={tenant} />
    </div>
  )
}
