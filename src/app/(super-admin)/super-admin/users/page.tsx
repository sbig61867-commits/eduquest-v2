export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { SuperUsersClient } from './users-client'
import { tenantRoleCountsAs } from '@/lib/super-admin-data'

export default async function AllUsersPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const [[tenants, superAdmins], { counts }] = await Promise.all([
    run({ as: 'user', userId: user.id }, sql => [
      sql`select id, name, slug, is_active, created_at from public.tenants order by name limit 1000`,
      // Super admins are few (1–5); load them fully for the platform-admins panel
      sql`select id, full_name, email, role, is_active, created_at, tenant_id from public.users
           where role = 'super_admin' order by created_at desc limit 100`,
    ]),
    // One row per institution from the database (get_tenant_role_counts), not every user row.
    tenantRoleCountsAs(user.id),
  ])

  return (
    <SuperUsersClient
      tenants={tenants as never}
      superAdmins={superAdmins as unknown as Parameters<typeof SuperUsersClient>[0]['superAdmins']}
      tenantCounts={counts}
    />
  )
}
