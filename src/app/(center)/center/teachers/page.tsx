export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { PeopleClient, type PersonRow } from '@/components/center/people-client'
import { teacherBlock, teacherFootprints } from '@/lib/account-scope'

export default async function CenterTeachersPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_teachers')) return <NoPermission capability="manage_teachers" />

  const [{ data }, { data: groups }, { data: courses }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, is_active, created_at')
      .eq('tenant_id', tenantId)
      .eq('role', 'teacher')
      .order('created_at', { ascending: false }),
    // Who teaches where: university groups vs centre courses / course sections.
    supabase.from('groups').select('teacher_id, course_id').eq('tenant_id', tenantId).is('deleted_at', null),
    supabase.from('courses').select('teacher_id').eq('tenant_id', tenantId).is('deleted_at', null),
  ])
  const footprints = teacherFootprints(groups ?? [], courses ?? [])
  // The route re-checks this server-side; the page only mirrors it.
  const people = ((data ?? []) as PersonRow[]).map(p => ({
    ...p,
    locked: teacherBlock(footprints.get(p.id) ?? { universityGroups: 0, centreItems: 0 }),
  }))

  return <PeopleClient role="teacher" initialPeople={people} />
}
