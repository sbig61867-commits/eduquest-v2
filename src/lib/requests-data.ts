import { run } from '@/lib/db/sql'
import type {
  RequestRow, RequestMessage, RecipientOption, GroupOption,
} from '@/components/requests/requests-inbox'

// Server-side loader for the teacher↔admin request inbox. ONE unit read as
// the caller, so RLS returns only the requests this user may see (super_admin:
// all; university_admin: whole tenant; others: their own).
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

const LIMIT = 500

export async function loadRequestsData(
  me: { id: string; role: string; tenant_id: string },
): Promise<{ requests: RequestRow[]; recipients: RecipientOption[]; groups: GroupOption[] }> {
  // Recipients: teacher writes to the tenant's admin(s); admin writes to teachers.
  const recipientRole = me.role === 'teacher' ? 'university_admin' : 'teacher'
  const [raw, recipientsRaw, groupsRaw] = await run({ as: 'user', userId: me.id }, sql => [
    sql`select r.id, r.type, r.subject, r.status, r.created_at, r.updated_at, r.from_user_id, r.to_user_id, r.group_id,
               json_build_object('full_name', fu.full_name) as from_user,
               json_build_object('full_name', tu.full_name) as to_user,
               case when g.id is null then null else json_build_object('name', g.name) end as "group",
               coalesce((select json_agg(json_build_object('id', m.id, 'sender_id', m.sender_id, 'body', m.body, 'created_at', m.created_at)
                                         order by m.created_at)
                           from public.request_messages m where m.request_id = r.id), '[]') as request_messages
          from public.staff_requests r
          left join public.users fu on fu.id = r.from_user_id
          left join public.users tu on tu.id = r.to_user_id
          left join public.groups g on g.id = r.group_id
         order by r.updated_at desc limit ${LIMIT}`,
    sql`select id, full_name from public.users
         where tenant_id = ${me.tenant_id} and role = ${recipientRole} and is_active order by full_name limit ${LIMIT}`,
    // Groups selectable when composing: a teacher's own, or (for admin) all
    // tenant groups keyed by teacher so the form can filter by chosen teacher.
    sql`select id, name, teacher_id from public.groups
         where tenant_id = ${me.tenant_id} and (${me.role} <> 'teacher' or teacher_id = ${me.id}) order by name limit ${LIMIT}`,
  ])

  const requests: RequestRow[] = (raw as unknown as RawReq[]).map(r => ({
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

  const recipients = recipientsRaw as unknown as RecipientOption[]
  const groups = groupsRaw as unknown as GroupOption[]

  return { requests, recipients, groups }
}
