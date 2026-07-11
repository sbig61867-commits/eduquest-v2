export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ArchiveClient, type ArchiveRow } from './archive-client'

export default async function AdminArchivePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  if (!user.tenant_id || !['university_admin', 'super_admin'].includes(user.role ?? '')) {
    redirect('/login')
  }

  // Full history — live + archived — via the SECURITY DEFINER function.
  const { data } = await supabase.rpc('get_tenant_archive', {
    p_tenant_id: user.tenant_id,
    p_year: null,
  })

  return <ArchiveClient rows={(data ?? []) as ArchiveRow[]} />
}
