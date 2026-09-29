export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { PeopleClient, type PersonRow } from '@/components/center/people-client'
import { studentBlock } from '@/lib/account-scope'
import { loadNameCompleteFlags } from '@/lib/student-names'

export default async function CenterStudentsPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_students')) return <NoPermission capability="manage_students" />

  const [{ data }, nameComplete] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, is_active, created_at, is_university_student')
      .eq('tenant_id', tenantId)
      .eq('role', 'student')
      .order('created_at', { ascending: false }),
    loadNameCompleteFlags(supabase, tenantId),
  ])

  return (
    <PeopleClient
      role="student"
      initialPeople={((data ?? []) as PersonRow[]).map(p => ({
        ...p,
        locked: studentBlock(p.is_university_student),
        name_complete: nameComplete ? nameComplete.get(p.id) === true : null,
      }))}
      canSetAffiliation={has('announce_to_university')}
    />
  )
}
