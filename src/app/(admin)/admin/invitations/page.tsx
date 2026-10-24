export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { InvitationsClient } from '@/components/shared/invitations-client'

export default async function AdminInvitationsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  if (!user.tenant_id) redirect('/login')

  const tenantId = user.tenant_id
  const [groups] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select id, name from public.groups where tenant_id = ${tenantId} order by name limit 1000`,
  ])

  return (
    <InvitationsClient
      callerRole="university_admin"
      tenants={[]}
      groups={groups as unknown as { id: string; name: string }[]}
    />
  )
}
