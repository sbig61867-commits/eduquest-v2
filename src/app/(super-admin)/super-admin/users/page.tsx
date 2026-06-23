export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SuperUsersClient } from './users-client'

export default async function AllUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: users }, { data: tenants }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, is_active, created_at, tenant_id, tenants(name, slug)')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('tenants')
      .select('id, name, slug, is_active, created_at')
      .order('name'),
  ])

  return <SuperUsersClient initialUsers={(users ?? []) as any} tenants={tenants ?? []} />
}
