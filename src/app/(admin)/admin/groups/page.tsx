export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { AdminGroupsClient } from './groups-client'
import { getTenantSettings } from '@/lib/structure-mode'

export default async function AdminGroupsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  if (!user.tenant_id) redirect('/login')

  const tenantId = user.tenant_id
  const academicMode = (await getTenantSettings(user.id, tenantId)).structure_mode === 'academic'
  // One unit as the admin: the groups, and — only for academic tenants — the
  // structure they are classified against ('flat' tenants skip those reads).
  const [groups, units, terms, links] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select g.id, g.name, g.description, g.is_active, g.created_at,
               case when u.id is null then null else json_build_object('full_name', u.full_name) end as users,
               json_build_array(json_build_object('count', (select count(*)::int from public.group_students s where s.group_id = g.id))) as group_students
          from public.groups g left join public.users u on u.id = g.teacher_id
         where g.tenant_id = ${tenantId} order by g.created_at desc limit 1000`,
    sql`select id, parent_id, level, name from public.academic_units
         where ${academicMode} and tenant_id = ${tenantId} order by sort_order, name limit 1000`,
    sql`select id, name, is_current from public.academic_terms
         where ${academicMode} and tenant_id = ${tenantId} order by starts_on desc limit 200`,
    sql`select id, academic_unit_id, term_id from public.groups
         where ${academicMode} and tenant_id = ${tenantId} limit 1000`,
  ])

  // Academic reads come back empty for 'flat' tenants: the classification column stays hidden.
  const academic = !academicMode ? null : {
    units: units as never,
    terms: terms as never,
    links: Object.fromEntries((links as { id: string; academic_unit_id: string | null; term_id: string | null }[])
      .map(l => [l.id, { academic_unit_id: l.academic_unit_id, term_id: l.term_id }])),
  }

  return <AdminGroupsClient initialGroups={groups as never} academic={academic as never} />
}
