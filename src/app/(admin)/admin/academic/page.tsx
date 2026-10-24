export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { redirect } from 'next/navigation'
import { NoPermission } from '@/components/shared/no-permission'
import { can } from '@/lib/permissions'
import { isAcademicMode } from '@/lib/structure-mode'
import { getTerms } from '@/lib/terminology'
import { AcademicClient, type AcademicTerm, type AcademicUnit } from './academic-client'

export default async function AdminAcademicPage() {
  const t = await getTranslations('admin.academic')
  const locale = (await getLocale()) as Locale
  const user = await currentUser()
  if (!user?.tenant_id) redirect('/login')

  const tenantId = user.tenant_id
  // One unit: the caller's capability, the institution's settings, and its
  // structure (RLS — academic_*_select — hides other tenants and archived rows;
  // the tenant filter stays as defence in depth). Shown only when allowed.
  const [profiles, tenants, unitRows, termRows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select role, permissions from public.users where id = ${user.id}`,
    sql`select institution_type, structure_mode from public.tenants where id = ${tenantId}`,
    sql`select id, parent_id, level, name, code, sort_order from public.academic_units
         where tenant_id = ${tenantId} order by sort_order, name limit 2000`,
    sql`select id, name, starts_on, ends_on, is_current from public.academic_terms
         where tenant_id = ${tenantId} order by starts_on desc limit 200`,
  ])
  const profile = profiles[0] as { role: string | null; permissions: Record<string, unknown> | null } | undefined
  const tenant = tenants[0] as { institution_type: string | null; structure_mode: string | null } | undefined

  // Original ('flat') structure: this page doesn't exist for the tenant.
  if (!isAcademicMode(tenant?.structure_mode)) {
    redirect('/admin/dashboard')
  }

  if (!can(profile?.role, profile?.permissions, 'manage_academic_structure')) {
    return <NoPermission capability="manage_academic_structure" />
  }

  // RLS (academic_*_select) already hides other tenants and archived rows;
  // the tenant filter stays as defence in depth.

  return (
    <AcademicClient
      terms={getTerms(tenant?.institution_type ?? undefined, locale)}
      initialUnits={unitRows as unknown as AcademicUnit[]}
      initialTerms={termRows as unknown as AcademicTerm[]}
    />
  )
}
