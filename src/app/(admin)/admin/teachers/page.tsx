export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PageTitle } from '@/components/shared/page-title'
import { TeachersClient } from './teachers-client'

export default async function TeachersPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: teachers } = await supabase
    .from('users')
    .select('id, email, full_name, avatar_url, role, is_active, created_at, tenant_id, can_create_courses')
    .eq('role', 'teacher')
    .eq('tenant_id', user.tenant_id)
    .order('created_at', { ascending: false })

  return (<><PageTitle title="Teachers" /><TeachersClient initialTeachers={teachers ?? []} /></>)
}
