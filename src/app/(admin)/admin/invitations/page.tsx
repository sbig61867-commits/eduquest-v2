export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InvitationsClient } from '@/components/shared/invitations-client'

export default async function AdminInvitationsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) redirect('/login')

  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tenant_id', profile.tenant_id)
    .order('name')

  return (
    <InvitationsClient
      callerRole="university_admin"
      tenants={[]}
      groups={groups ?? []}
    />
  )
}
