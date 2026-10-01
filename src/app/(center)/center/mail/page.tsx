export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { MailClient, type RecipientGroup } from '@/components/mail/mail-client'

export default async function CenterMailPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_students')) return <NoPermission capability="manage_students" />

  // Students are found on demand (/api/mail/recipients, ≤ 20 per search) and a
  // group is sent as its id and resolved on the server — the page carries
  // neither the student body nor any group's member list, only each group's size.
  const { data: groups } = await supabase.from('groups').select('id, name, group_students(count)')
    .eq('tenant_id', tenantId).eq('is_active', true).order('name')

  const groupOptions: RecipientGroup[] = ((groups ?? []) as unknown as { id: string; name: string; group_students: { count: number }[] | null }[])
    .map(g => ({ id: g.id, name: g.name, member_count: g.group_students?.[0]?.count ?? 0 }))

  return <MailClient groups={groupOptions} />
}
