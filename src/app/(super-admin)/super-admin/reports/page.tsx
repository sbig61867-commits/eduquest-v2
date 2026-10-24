export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { ReportsClient } from './reports-client'

export default async function ReportsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  // The owner check first: a refused caller reads nothing else.
  const [profiles] = await run({ as: 'user', userId: user.id }, sql => [sql`select role from public.users where id = ${user.id}`])
  if ((profiles[0] as { role: string } | undefined)?.role !== 'super_admin') redirect('/login')
  const [tenantRows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select id, name from public.tenants order by name limit 1000`,
  ])

  // RLS grants super_admin cross-tenant SELECT on tenants. Teachers, students and
  // groups are found on demand inside the chosen institution
  // (/api/admin/report-targets, ≤ 20 per search) — never preloaded.
  return <ReportsClient tenants={tenantRows as unknown as { id: string; name: string }[]} />
}
