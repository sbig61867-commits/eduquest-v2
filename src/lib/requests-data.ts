import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  RequestRow, RequestMessage, RecipientOption, GroupOption,
} from '@/components/requests/requests-inbox'

// Server-side loader for the teacher↔admin request inbox. Reads run through
// the caller's session client, so RLS returns only the requests this user may
// see (super_admin: all; university_admin: whole tenant; others: their own).
interface RawReq {
  id: string
  type: RequestRow['type']
  subject: string
  status: RequestRow['status']
  created_at: string
  updated_at: string
  from_user_id: string
  to_user_id: string
  group_id: string | null
  from_user: { full_name: string | null } | null
  to_user: { full_name: string | null } | null
  group: { name: string } | null
  request_messages: RequestMessage[]
}

export async function loadRequestsData(
  supabase: SupabaseClient,
  me: { id: string; role: string; tenant_id: string },
): Promise<{ requests: RequestRow[]; recipients: RecipientOption[]; groups: GroupOption[] }> {
  const { data: raw } = await supabase
    .from('staff_requests')
    .select(`
      id, type, subject, status, created_at, updated_at, from_user_id, to_user_id, group_id,
      from_user:users!staff_requests_from_user_id_fkey(full_name),
      to_user:users!staff_requests_to_user_id_fkey(full_name),
      group:groups(name),
      request_messages(id, sender_id, body, created_at)
    `)
    .order('updated_at', { ascending: false })

  const requests: RequestRow[] = ((raw ?? []) as unknown as RawReq[]).map(r => ({
    id: r.id,
    type: r.type,
    subject: r.subject,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    from_user_id: r.from_user_id,
    to_user_id: r.to_user_id,
    from_name: r.from_user?.full_name ?? null,
    to_name: r.to_user?.full_name ?? null,
    group_name: r.group?.name ?? null,
    messages: r.request_messages ?? [],
  }))

  // Recipients: teacher writes to the tenant's admin(s); admin writes to teachers.
  const recipientRole = me.role === 'teacher' ? 'university_admin' : 'teacher'
  const { data: recipientsRaw } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('tenant_id', me.tenant_id)
    .eq('role', recipientRole)
    .eq('is_active', true)
    .order('full_name')
  const recipients = (recipientsRaw ?? []) as RecipientOption[]

  // Groups selectable when composing: a teacher's own, or (for admin) all
  // tenant groups keyed by teacher so the form can filter by chosen teacher.
  let groupsQuery = supabase.from('groups').select('id, name, teacher_id').eq('tenant_id', me.tenant_id)
  if (me.role === 'teacher') groupsQuery = groupsQuery.eq('teacher_id', me.id)
  const { data: groupsRaw } = await groupsQuery.order('name')
  const groups = (groupsRaw ?? []) as GroupOption[]

  return { requests, recipients, groups }
}
