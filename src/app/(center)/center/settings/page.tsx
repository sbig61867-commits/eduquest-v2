import { redirect } from 'next/navigation'
import { AccountSettings } from '@/components/shared/account-settings'
import { MyPermissionsCard } from '@/components/shared/my-permissions-card'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { resolvePermissions } from '@/lib/permissions'

// Account settings for the centre manager: the shared account section, then
// what the institution allows them to do (read-only).
export default async function CenterSettingsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('users').select('role, permissions').eq('id', user.id).single()
  const permissions = resolvePermissions(me?.role, me?.permissions as Record<string, unknown> | null)

  return (
    <div className="max-w-2xl space-y-6">
      <AccountSettings />
      <MyPermissionsCard permissions={permissions} />
    </div>
  )
}
