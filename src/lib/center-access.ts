import { redirect } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { resolvePermissions, type Capability } from '@/lib/permissions'

/**
 * Server-page loader for the centre panel: session client, tenant, and the
 * caller's resolved capability map. The proxy already restricts /center to
 * the center_manager role; the page still decides per capability what to show.
 */
export async function loadCenterAccess() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role, permissions').eq('id', user.id).single()
  const perms = resolvePermissions(profile?.role, profile?.permissions)

  return {
    supabase,
    userId: user.id,
    tenantId: user.tenant_id,
    perms,
    has: (cap: Capability) => perms[cap] === true,
  }
}
