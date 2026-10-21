export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GroupsClient } from './groups-client'
import { ScopedIntlProvider } from '@/i18n/provider'

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

  // «إدارة الطلاب» finds students on demand through /api/students/search
  // (≤ 20 per search); the institution's student body is never sent to the page.
  // 'staff' is the student's reset-password button (src/components/shared/reset-password-button.tsx).
  return (
    <ScopedIntlProvider namespaces={['common', 'teacher', 'terms', 'staff']}>
      <GroupsClient
        initialGroups={groups ?? []}
        teacherId={user.id}
        tenantId={profile.tenant_id}
      />
    </ScopedIntlProvider>
  )
}
