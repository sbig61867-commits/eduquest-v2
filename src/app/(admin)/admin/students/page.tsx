export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentsClient } from './students-client'
import { canSetAffiliation } from '@/lib/student-affiliation'
import { getTenantSettings } from '@/lib/structure-mode'

export default async function StudentsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  if (!user.tenant_id) redirect('/login')

  const [{ data: students }, { data: profile }, settings] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, full_name, avatar_url, role, is_active, created_at, tenant_id, can_create_courses, is_university_student')
      .eq('role', 'student')
      .eq('tenant_id', user.tenant_id)
      .order('created_at', { ascending: false }),
    supabase.from('users').select('role, permissions').eq('id', user.id).single(),
    getTenantSettings(supabase, user.tenant_id),
  ])

  return (
    <StudentsClient
      initialStudents={students ?? []}
      canSetAffiliation={settings.has_center && canSetAffiliation(profile ?? { role: user.role, permissions: null })}
      hasCenter={settings.has_center}
    />
  )
}
