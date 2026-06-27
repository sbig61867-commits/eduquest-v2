export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { ReportsClient } from './reports-client'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') redirect('/login')

  const admin = adminClient()
  const [{ data: tenants }, { data: teachers }, { data: groups }] = await Promise.all([
    admin.from('tenants').select('id, name').order('name'),
    admin.from('users').select('id, full_name, email, tenant_id').eq('role', 'teacher').order('full_name'),
    admin.from('groups').select('id, name, tenant_id').order('name'),
  ])

  return (
    <ReportsClient
      tenants={tenants ?? []}
      teachers={teachers ?? []}
      groups={groups ?? []}
    />
  )
}
