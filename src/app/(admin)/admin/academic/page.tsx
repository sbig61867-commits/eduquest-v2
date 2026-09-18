export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { can } from '@/lib/permissions'
import { isAcademicMode } from '@/lib/structure-mode'
import { getTerms } from '@/lib/terminology'
import { AcademicClient, type AcademicTerm, type AcademicUnit } from './academic-client'

export default async function AdminAcademicPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const [{ data: profile }, { data: tenant }] = await Promise.all([
    supabase.from('users').select('role, permissions').eq('id', user.id).single(),
    // `*` so a not-yet-migrated column is just absent instead of failing the query
    supabase.from('tenants').select('*').eq('id', user.tenant_id).maybeSingle(),
  ])

  // Original ('flat') structure: this page doesn't exist for the tenant.
  if (!isAcademicMode((tenant as { structure_mode?: unknown } | null)?.structure_mode)) {
    redirect('/admin/dashboard')
  }

  if (!can(profile?.role, profile?.permissions, 'manage_academic_structure')) {
    return (
      <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl" dir="rtl">
        <ShieldAlert className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">لا تملك صلاحية إدارة الهيكل الأكاديمي.</p>
      </div>
    )
  }

  // RLS (academic_*_select) already hides other tenants and archived rows;
  // the tenant filter stays as defence in depth.
  const [units, terms] = await Promise.all([
    supabase.from('academic_units').select('id, parent_id, level, name, code, sort_order')
      .eq('tenant_id', user.tenant_id).order('sort_order').order('name'),
    supabase.from('academic_terms').select('id, name, starts_on, ends_on, is_current')
      .eq('tenant_id', user.tenant_id).order('starts_on', { ascending: false }),
  ])

  if (units.error || terms.error) {
    return (
      <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
        <p className="text-slate-400">
          الهيكل الأكاديمي غير متاح بعد — طبّق
          <code className="mx-1 text-slate-300">supabase/academic_structure_migration.sql</code>.
        </p>
      </div>
    )
  }

  return (
    <AcademicClient
      terms={getTerms((tenant as { institution_type?: string } | null)?.institution_type)}
      initialUnits={(units.data ?? []) as AcademicUnit[]}
      initialTerms={(terms.data ?? []) as AcademicTerm[]}
    />
  )
}
