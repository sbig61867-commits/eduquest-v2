export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { run } from '@/lib/db/sql'
import { NoPermission } from '@/components/shared/no-permission'
import { MailClient, type RecipientGroup } from '@/components/mail/mail-client'

export default async function CenterMailPage() {
  const { userId, tenantId, has } = await loadCenterAccess()
  if (!has('manage_students')) return <NoPermission capability="manage_students" />

  // Students are found on demand (/api/mail/recipients, ≤ 20 per search) and a
  // group is sent as its id and resolved on the server — the page carries
  // neither the student body nor any group's member list, only each group's size.
  const [groups] = await run({ as: 'user', userId }, sql => [
    sql`select c.id, c.name, json_build_array(json_build_object('count', (select count(*)::int from public.group_students x where x.group_id = c.id))) as group_students
          from public.groups c where c.tenant_id = ${tenantId} and c.is_active order by c.name limit 1000`,
  ])

  const groupOptions: RecipientGroup[] = ((groups) as unknown as { id: string; name: string; group_students: { count: number }[] | null }[])
    .map(g => ({ id: g.id, name: g.name, member_count: g.group_students?.[0]?.count ?? 0 }))

  return <MailClient groups={groupOptions} />
}
