import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { resolvePermissions, type Capability } from '@/lib/permissions'

/**
 * Server-page loader for the centre panel: the caller, tenant, and the
 * caller's resolved capability map. The proxy already restricts /center to
 * the center_manager role; the page still decides per capability what to show.
 */
export async function loadCenterAccess() {
  const user = await currentUser()
  if (!user?.tenant_id) redirect('/login')

  const [rows] = await run({ as: 'user', userId: user.id }, sql => [sql`select role, permissions from public.users where id = ${user.id}`])
  const profile = maybeOne<{ role: string | null; permissions: Record<string, unknown> | null }>(rows)
  const perms = resolvePermissions(profile?.role, profile?.permissions)

  return {
    userId: user.id,
    tenantId: user.tenant_id,
    perms,
    has: (cap: Capability) => perms[cap] === true,
  }
}
