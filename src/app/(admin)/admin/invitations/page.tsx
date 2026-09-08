export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PageTitle } from '@/components/shared/page-title'
import { InvitationsClient } from '@/components/shared/invitations-client'

export default async function AdminInvitationsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  if (!user.tenant_id) redirect('/login')

  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tenant_id', user.tenant_id)
    .order('name')

  return (
    <InvitationsClient
      callerRole="university_admin"
      tenants={[]}
      groups={groups ?? []}
    />
  )
}
