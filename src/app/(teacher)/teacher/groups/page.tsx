export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { GroupsClient } from './groups-client'

// Fetch groups and students using the admin client to bypass RLS helper
// functions (current_tenant_id / current_user_role) which may return NULL
// under PostgREST's restricted search_path if the DB migration hasn't been applied.
// Authorization is guaranteed by the proxy (role-to-route mapping) and the
// .eq('teacher_id', user.id) / .eq('tenant_id', ...) filters below.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function GroupsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Read the teacher's profile (users SELECT policy has id=auth.uid() escape — always works)
  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) redirect('/login?error=university_removed')

  const admin = adminClient()

  // Fetch groups scoped to this teacher (admin client bypasses broken RLS helpers)
  const { data: groups } = await admin
    .from('groups')
    .select('*, group_students(count)')
    .eq('teacher_id', user.id)
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })

  // Fetch all students in the same tenant for the "Manage Students" modal
  const { data: tenantStudents } = await admin
    .from('users')
    .select('id, full_name, email')
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'student')
    .eq('is_active', true)
    .order('full_name')

  return (
    <GroupsClient
      initialGroups={groups ?? []}
      tenantStudents={tenantStudents ?? []}
      teacherId={user.id}
      tenantId={profile.tenant_id}
    />
  )
}
