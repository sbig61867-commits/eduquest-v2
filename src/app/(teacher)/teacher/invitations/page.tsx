export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { InvitationsClient } from '@/components/shared/invitations-client'
import { ScopedIntlProvider } from '@/i18n/provider'

export default async function TeacherInvitationsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const [groups] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select id, name from public.groups where teacher_id = ${user.id} order by name limit 500`,
  ])

  return (
    <ScopedIntlProvider namespaces={['common', 'teacher', 'terms', 'staff']}>
      <InvitationsClient
        callerRole="teacher"
        tenants={[]}
        groups={groups as unknown as { id: string; name: string }[]}
      />
    </ScopedIntlProvider>
  )
}
