export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { getRoleLabel } from '@/lib/utils'
import { redirect } from 'next/navigation'
import { RequestsInbox } from '@/components/requests/requests-inbox'
import { loadRequestsData } from '@/lib/requests-data'

export default async function AdminRequestsPage() {
  const locale = (await getLocale()) as Locale
  const user = await currentUser()
  if (!user?.tenant_id || !user.role) redirect('/login')

  const { requests, recipients, groups } = await loadRequestsData(
    { id: user.id, role: user.role, tenant_id: user.tenant_id },
  )

  return (
    <RequestsInbox
      me={{ id: user.id, role: user.role }}
      requests={requests}
      recipients={recipients}
      groups={groups}
      recipientLabel={getRoleLabel('teacher', undefined, locale)}
    />
  )
}
