export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RequestsInbox } from '@/components/requests/requests-inbox'
import { loadRequestsData } from '@/lib/requests-data'
import { getTranslations } from 'next-intl/server'
import { ScopedIntlProvider } from '@/i18n/provider'

export default async function TeacherRequestsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id || !user.role) redirect('/login')
  const t = await getTranslations('teacher')

  const { requests, recipients, groups } = await loadRequestsData(
    supabase, { id: user.id, role: user.role, tenant_id: user.tenant_id },
  )

  return (
    <ScopedIntlProvider namespaces={['common', 'teacher', 'terms', 'staff']}>
      <RequestsInbox
        me={{ id: user.id, role: user.role }}
        requests={requests}
        recipients={recipients}
        groups={groups}
        recipientLabel={t('requests.recipientLabel')}
      />
    </ScopedIntlProvider>
  )
}
