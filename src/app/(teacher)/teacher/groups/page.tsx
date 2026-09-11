export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GroupsClient } from './groups-client'
import { PageTitle } from '@/components/shared/page-title'

export default async function GroupsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Read the teacher's profile (users SELECT policy has id=auth.uid() escape — always works)
  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) redirect('/login?error=university_removed')

  // RLS scopes this to the teacher's own groups; the .eq filters below
  // are kept as defense-in-depth.
  const { data: groups } = await supabase
    .from('groups')
    .select('*, group_students(count)')
    .eq('teacher_id', user.id)
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })

  // Fetch all students in the same tenant for the "Manage Students" modal
  const { data: tenantStudents } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'student')
    .eq('is_active', true)
    .order('full_name')

  return (
    <>
      <PageTitle title="Groups" />
      <GroupsClient
        initialGroups={groups ?? []}
        tenantStudents={tenantStudents ?? []}
        teacherId={user.id}
        tenantId={profile.tenant_id}
      />
    </>
  )
}
