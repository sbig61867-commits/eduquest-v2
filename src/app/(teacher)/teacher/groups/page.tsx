export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GroupsClient } from './groups-client'

export default async function GroupsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: groups }, { data: profile }] = await Promise.all([
    supabase
      .from('groups')
      .select('*, group_students(count)')
      .eq('teacher_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single(),
  ])

  const { data: tenantStudents } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('tenant_id', profile?.tenant_id ?? '')
    .eq('role', 'student')
    .eq('is_active', true)
    .order('full_name')

  if (!profile?.tenant_id) redirect('/login')

  return (
    <GroupsClient
      initialGroups={groups ?? []}
      tenantStudents={tenantStudents ?? []}
      teacherId={user.id}
      tenantId={profile.tenant_id}
    />
  )
}
