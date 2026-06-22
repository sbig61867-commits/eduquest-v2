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
      .select('*, tenants(name)')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('tenants')
      .select('id, name')
      .eq('is_active', true)
      .order('name'),
  ])

  return <SuperUsersClient initialUsers={users ?? []} tenants={tenants ?? []} />
}
