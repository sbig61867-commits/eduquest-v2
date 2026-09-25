export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { PeopleClient, type PersonRow } from '@/components/center/people-client'

export default async function CenterStudentsPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_students')) return <NoPermission capability="manage_students" />

  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, is_active, created_at, is_university_student')
    .eq('tenant_id', tenantId)
    .eq('role', 'student')
    .order('created_at', { ascending: false })

  return (
    <PeopleClient
      role="student"
      initialPeople={(data ?? []) as PersonRow[]}
      canSetAffiliation={has('announce_to_university')}
    />
  )
}
