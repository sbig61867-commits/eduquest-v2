export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/center/no-permission'
import { MailClient, type Recipient, type RecipientGroup } from '@/components/mail/mail-client'

export default async function CenterMailPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_students')) return <NoPermission label="إدارة الطلاب" />

  const [{ data: students }, { data: groups }] = await Promise.all([
    supabase.from('users').select('id, full_name, email')
      .eq('tenant_id', tenantId).eq('role', 'student').eq('is_active', true).order('full_name'),
    supabase.from('groups').select('id, name, is_active, group_students(student_id)')
      .eq('tenant_id', tenantId).eq('is_active', true).order('name'),
  ])

  const recipients: Recipient[] = (students ?? []).map(s => ({
    id: s.id as string, name: (s.full_name as string) || '—', email: s.email as string,
  }))
  const groupOptions: RecipientGroup[] = ((groups ?? []) as unknown as { id: string; name: string; group_students: { student_id: string }[] | null }[])
    .map(g => ({ id: g.id, name: g.name, member_ids: (g.group_students ?? []).map(m => m.student_id) }))

  return <MailClient recipients={recipients} groups={groupOptions} />
}
