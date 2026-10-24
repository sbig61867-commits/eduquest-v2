export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { seatUsageAs, storageUsageAs } from '@/lib/super-admin-data'
import { TenantsClient } from './tenants-client'

export default async function TenantsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const [tenants] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select * from public.tenants order by created_at desc limit 1000`,
  ])
  const rows = tenants as unknown as { id: string; storage_limit_mb: number | null }[]

  // Live seat usage per institution (the owner's session reads every tenant).
  const seats = Object.fromEntries(await Promise.all(
    rows.map(async t => [t.id, await seatUsageAs(user.id, t.id)] as const),
  ))

  // Live file-storage usage (tenant_storage_bytes allows super_admin).
  const storage = Object.fromEntries(await Promise.all(
    rows.map(async t => [t.id, await storageUsageAs(user.id, t.id, t.storage_limit_mb)] as const),
  ))

  return <TenantsClient initialTenants={tenants as never} seats={seats} storage={storage} />
}
