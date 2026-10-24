export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { ArchiveClient, type ArchiveRow } from './archive-client'

export default async function AdminArchivePage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  if (!user.tenant_id || !['university_admin', 'super_admin'].includes(user.role ?? '')) {
    redirect('/login')
  }

  // Full history — live + archived — via the SECURITY DEFINER function.
  const tenantId = user.tenant_id
  const [data] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select * from public.get_tenant_archive(p_tenant_id => ${tenantId}, p_year => null)`,
  ])

  return <ArchiveClient rows={data as unknown as ArchiveRow[]} />
}
