export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdminGroupsClient } from './groups-client'
import { getTenantStructureMode } from '@/lib/structure-mode'

export default async function AdminGroupsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  if (!user.tenant_id) redirect('/login')

  const tenantId = user.tenant_id
  const academicMode = (await getTenantStructureMode(supabase, tenantId)) === 'academic'
  const [{ data: groups }, units, terms, links] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, description, is_active, created_at, users:teacher_id(full_name), group_students(count)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    // Academic queries only run for tenants that opted in; 'flat' tenants see the original page.
    academicMode ? supabase.from('academic_units').select('id, parent_id, level, name')
      .eq('tenant_id', tenantId).order('sort_order').order('name') : null,
    academicMode ? supabase.from('academic_terms').select('id, name, is_current')
      .eq('tenant_id', tenantId).order('starts_on', { ascending: false }) : null,
    academicMode ? supabase.from('groups').select('id, academic_unit_id, term_id').eq('tenant_id', tenantId) : null,
  ])

  // Any error ⇒ migration not applied yet ⇒ the classification column is hidden.
  const academic = !units || !terms || !links || units.error || terms.error || links.error ? null : {
    units: units.data ?? [],
    terms: terms.data ?? [],
    links: Object.fromEntries((links.data ?? []).map(l => [l.id, { academic_unit_id: l.academic_unit_id, term_id: l.term_id }])),
  }

  return <AdminGroupsClient initialGroups={(groups ?? []) as never} academic={academic as never} />
}
