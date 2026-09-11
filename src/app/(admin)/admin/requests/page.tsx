export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RequestsInbox } from '@/components/requests/requests-inbox'
import { PageTitle } from '@/components/shared/page-title'
import { loadRequestsData } from '@/lib/requests-data'

export default async function AdminRequestsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id || !user.role) redirect('/login')

  const { requests, recipients, groups } = await loadRequestsData(
    supabase, { id: user.id, role: user.role, tenant_id: user.tenant_id },
  )

  return (
    <>
      <PageTitle title="Requests" />
      <RequestsInbox
        me={{ id: user.id, role: user.role }}
        requests={requests}
        recipients={recipients}
        groups={groups}
        recipientLabel="المعلم"
      />
    </>
  )
}
