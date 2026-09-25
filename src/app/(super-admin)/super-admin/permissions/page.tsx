export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import type { Role } from '@/types'
import { getRoleLabel } from '@/lib/utils'
import { PermissionsEditor, type StaffMember } from '@/components/shared/permissions-editor'
import { resolvePermissions, CAPABILITIES } from '@/lib/permissions'
import type { Capability } from '@/lib/permissions'

// The platform owner decides what each university_admin (and centre manager)
// may do. super_admin holds every capability, so nothing is disabled here.
interface StaffRow {
  id: string
  full_name: string | null
  email: string
  role: string
  is_active: boolean
  permissions: Record<string, boolean> | null
  tenant_id: string | null
  tenants: { name: string; institution_type: string | null } | null
}

export default async function SuperAdminPermissionsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('users')
    .select('id, full_name, email, role, is_active, permissions, tenant_id, tenants(name, institution_type)')
    .in('role', ['university_admin', 'center_manager'])
    .order('role')

  const staffRows = (rows ?? []) as unknown as StaffRow[]
  const [t, locale] = await Promise.all([getTranslations('superAdmin.permissions'), getLocale() as Promise<Locale>])

  const staff: StaffMember[] = staffRows.map(r => ({
    id: r.id,
    full_name: `${r.full_name ?? '—'} · ${r.tenants?.name ?? t('noTenant')}`,
    email: `${r.email} — ${getRoleLabel(r.role as Role, r.tenants?.institution_type, locale)}`,
    role: r.role,
    is_active: r.is_active,
    effective: resolvePermissions(r.role, r.permissions),
  }))

  // super_admin can grant everything.
  const grantable = Object.fromEntries(CAPABILITIES.map(c => [c, true])) as Record<Capability, boolean>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>
      <PermissionsEditor
        staff={staff}
        grantable={grantable}
        emptyHint={t('emptyHint')}
      />
    </div>
  )
}
