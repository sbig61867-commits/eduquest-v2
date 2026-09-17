export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/center/no-permission'
import { PeopleClient, type PersonRow } from '@/components/center/people-client'

export default async function CenterTeachersPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_teachers')) return <NoPermission label="إدارة المدربين" />

  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, is_active, created_at')
    .eq('tenant_id', tenantId)
    .eq('role', 'teacher')
    .order('created_at', { ascending: false })

  return <PeopleClient role="teacher" initialPeople={(data ?? []) as PersonRow[]} />
}
