export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InvitationsClient } from '@/components/shared/invitations-client'

export default async function TeacherInvitationsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('teacher_id', user.id)
    .order('name')

  return (
    <InvitationsClient
      callerRole="teacher"
      tenants={[]}
      groups={groups ?? []}
    />
  )
}
