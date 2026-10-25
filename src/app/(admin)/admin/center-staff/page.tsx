export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { PermissionsEditor, type StaffMember } from '@/components/shared/permissions-editor'
import { can, resolvePermissions } from '@/lib/permissions'
import { NoPermission } from '@/components/shared/no-permission'
import { getTenantSettings } from '@/lib/data/tenant-settings'

// The university_admin grants capabilities to their centre managers.
// The escalation guard (you cannot grant what you don't hold) is enforced
// server-side in /api/admin/permissions; the UI mirrors it by disabling
// toggles the admin doesn't have.
export default async function AdminCenterStaffPage() {
  const t = await getTranslations('admin.centerStaff')
  const user = await currentUser()
  if (!user?.tenant_id) redirect('/login')

  // Institutions without a continuing-education centre have no centre staff.
  const tenantId = user.tenant_id
  if (!(await getTenantSettings(user.id, tenantId)).has_center) redirect('/admin/dashboard')

  const [meRows, rows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select role, permissions from public.users where id = ${user.id}`,
    sql`select id, full_name, email, role, is_active, permissions from public.users
         where tenant_id = ${tenantId} and role = 'center_manager' order by full_name limit 500`,
  ])
  const me = meRows[0] as { role: string | null; permissions: Record<string, unknown> | null } | undefined

  if (!can(me?.role, me?.permissions, 'manage_center_staff')) {
    return <NoPermission capability="manage_center_staff" />
  }

  const staff: StaffMember[] = ((rows ?? []) as unknown as Array<{
    id: string; full_name: string | null; email: string; role: string
    is_active: boolean; permissions: Record<string, boolean> | null
  }>).map(r => ({
    id: r.id,
    full_name: r.full_name,
    email: r.email,
    role: r.role,
    is_active: r.is_active,
    effective: resolvePermissions(r.role, r.permissions),
  }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">
          {t('subtitle')}
        </p>
      </div>
      <PermissionsEditor
        staff={staff}
        grantable={resolvePermissions(me?.role, me?.permissions)}
        emptyHint={t('emptyHint')}
      />
    </div>
  )
}
