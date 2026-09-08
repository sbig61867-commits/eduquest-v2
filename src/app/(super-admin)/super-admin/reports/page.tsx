export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReportsClient } from './reports-client'
import { PageTitle } from '@/components/shared/page-title'

export default async function ReportsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') redirect('/login')

  // RLS grants super_admin cross-tenant SELECT on tenants/users/groups.
  const [{ data: tenants }, { data: teachers }, { data: groups }, { data: students }] = await Promise.all([
    supabase.from('tenants').select('id, name').order('name'),
    supabase.from('users').select('id, full_name, email, tenant_id').eq('role', 'teacher').order('full_name'),
    supabase.from('groups').select('id, name, tenant_id').order('name'),
    supabase.from('users').select('id, full_name, email, tenant_id').eq('role', 'student').order('full_name'),
  ])

  return (
    <>
      <PageTitle title="Reports" />
      <ReportsClient
        tenants={tenants ?? []}
        teachers={teachers ?? []}
        groups={groups ?? []}
        students={students ?? []}
      />
    </>
  )
}
