export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ArchiveClient, type ArchiveRow } from './archive-client'

export default async function AdminArchivePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('tenant_id, role').eq('id', user.id).single()
  if (!profile?.tenant_id || !['university_admin', 'super_admin'].includes(profile.role ?? '')) {
    redirect('/login')
  }

  // Full history — live + archived — via the SECURITY DEFINER function.
  const { data } = await supabase.rpc('get_tenant_archive', {
    p_tenant_id: profile.tenant_id,
    p_year: null,
  })

  return <ArchiveClient rows={(data ?? []) as ArchiveRow[]} />
}
