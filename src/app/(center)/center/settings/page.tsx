import { redirect } from 'next/navigation'
import { AccountSettings } from '@/components/shared/account-settings'
import { MyPermissionsCard } from '@/components/shared/my-permissions-card'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { resolvePermissions } from '@/lib/permissions'

// Account settings for the centre manager: the shared account section, then
// what the institution allows them to do (read-only).
export default async function CenterSettingsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const [rows] = await run({ as: 'user', userId: user.id }, sql => [sql`select role, permissions from public.users where id = ${user.id}`])
  const me = rows[0] as { role: string | null; permissions: unknown } | undefined
  const permissions = resolvePermissions(me?.role, me?.permissions as Record<string, unknown> | null)

  return (
    <div className="max-w-2xl space-y-6">
      <AccountSettings />
      <MyPermissionsCard permissions={permissions} />
    </div>
  )
}
