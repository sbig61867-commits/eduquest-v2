export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getSeatUsage } from '@/lib/seat-limit'
import { getStorageUsage } from '@/lib/storage-quota'
import { TenantsClient } from './tenants-client'

export default async function TenantsPage() {
  const supabase = await createClient()
  const { data: tenants } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false })

  // Live seat usage per institution (the owner's session reads every tenant).
  const seats = Object.fromEntries(await Promise.all(
    (tenants ?? []).map(async t => [t.id, await getSeatUsage(supabase, t.id)] as const),
  ))

  // Live file-storage usage (tenant_storage_bytes allows super_admin).
  const storage = Object.fromEntries(await Promise.all(
    (tenants ?? []).map(async t => [t.id, await getStorageUsage(supabase, t.id, t.storage_limit_mb)] as const),
  ))

  return <TenantsClient initialTenants={tenants ?? []} seats={seats} storage={storage} />
}
