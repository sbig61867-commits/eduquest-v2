export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SuperUsersClient } from './users-client'
import { PageTitle } from '@/components/shared/page-title'

export default async function AllUsersPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [
    { data: tenants },
    { data: superAdmins },
    { data: roleCounts },
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
    // Tiny rows (just two columns) — no per-row data, used only to derive counts
    supabase
      .from('users')
      .select('tenant_id, role')
      .neq('role', 'super_admin'),
  ])

  // Compute per-tenant role counts from the lightweight query
  const counts: Record<string, { admins: number; teachers: number; students: number }> = {}
  for (const row of roleCounts ?? []) {
    if (!row.tenant_id) continue
    if (!counts[row.tenant_id]) counts[row.tenant_id] = { admins: 0, teachers: 0, students: 0 }
    if (row.role === 'university_admin') counts[row.tenant_id].admins++
    else if (row.role === 'teacher')     counts[row.tenant_id].teachers++
    else if (row.role === 'student')     counts[row.tenant_id].students++
  }

  return (
    <>
      <PageTitle title="Users" />
      <SuperUsersClient
        tenants={tenants ?? []}
        superAdmins={(superAdmins ?? []) as Parameters<typeof SuperUsersClient>[0]['superAdmins']}
        tenantCounts={counts}
      />
    </>
  )
}
