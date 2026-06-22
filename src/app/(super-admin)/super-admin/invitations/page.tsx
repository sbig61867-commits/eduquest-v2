export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InvitationsClient } from '@/components/shared/invitations-client'

export default async function SuperAdminInvitationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tenants } = await supabase
    .from('tenants').select('id, name').eq('is_active', true).order('name')

  return (
    <InvitationsClient
      callerRole="super_admin"
      tenants={tenants ?? []}
      groups={[]}
    />
  )
}
