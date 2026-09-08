export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InvitationsClient } from '@/components/shared/invitations-client'
import { PageTitle } from '@/components/shared/page-title'

export default async function SuperAdminInvitationsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: tenants } = await supabase
    .from('tenants').select('id, name').eq('is_active', true).order('name')

  return (
    <>
      <PageTitle title="Invitations" />
      <InvitationsClient
        callerRole="super_admin"
        tenants={tenants ?? []}
        groups={[]}
      />
    </>
  )
}
