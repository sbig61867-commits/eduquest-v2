export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SuperUsersClient } from './users-client'
import { loadTenantRoleCounts } from '@/lib/data/tenant-counts'

export default async function AllUsersPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [
    { data: tenants },
    { data: superAdmins },
    { counts },
  ] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, slug, is_active, created_at')
      .order('name'),
    // Super admins are few (1–5); load them fully for the platform-admins panel
    supabase
      .from('users')
      .select('id, full_name, email, role, is_active, created_at, tenant_id')
      .eq('role', 'super_admin')
      .order('created_at', { ascending: false }),
    // One row per institution from the database (get_tenant_role_counts), not every user row.
    loadTenantRoleCounts(supabase),
  ])

  return (
    <SuperUsersClient
      tenants={tenants ?? []}
      superAdmins={(superAdmins ?? []) as Parameters<typeof SuperUsersClient>[0]['superAdmins']}
      tenantCounts={counts}
    />
  )
}
