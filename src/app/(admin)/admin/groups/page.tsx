export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PageTitle } from '@/components/shared/page-title'
import { AdminGroupsClient } from './groups-client'

export default async function AdminGroupsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  if (!user.tenant_id) redirect('/login')

  const { data: groups } = await supabase
    .from('groups')
    .select('id, name, description, is_active, created_at, users:teacher_id(full_name), group_students(count)')
    .eq('tenant_id', user.tenant_id)
    .order('created_at', { ascending: false })

  return (<><PageTitle title="Groups" /><AdminGroupsClient initialGroups={(groups ?? []) as never} /></>)
}
