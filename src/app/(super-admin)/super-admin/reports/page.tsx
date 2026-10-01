export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReportsClient } from './reports-client'

export default async function ReportsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') redirect('/login')

  // RLS grants super_admin cross-tenant SELECT on tenants. Teachers, students and
  // groups are found on demand inside the chosen institution
  // (/api/admin/report-targets, ≤ 20 per search) — never preloaded.
  const { data: tenants } = await supabase.from('tenants').select('id, name').order('name')

  return <ReportsClient tenants={tenants ?? []} />
}
