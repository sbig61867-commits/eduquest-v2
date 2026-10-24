export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { InvitationsClient } from '@/components/shared/invitations-client'

export default async function SuperAdminInvitationsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const [tenants] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select id, name from public.tenants where is_active order by name limit 1000`,
  ])

  return (
    <InvitationsClient
      callerRole="super_admin"
      tenants={tenants as unknown as { id: string; name: string }[]}
      groups={[]}
    />
  )
}
