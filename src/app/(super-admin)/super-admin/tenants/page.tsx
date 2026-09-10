export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { TenantsClient } from './tenants-client'

export default async function TenantsPage() {
  const supabase = await createClient()
  const { data: tenants } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false })

  return <TenantsClient initialTenants={tenants ?? []} />
}
