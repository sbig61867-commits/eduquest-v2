import { run } from '@/lib/db/sql'

/**
 * Who a /center/mail message goes to (Batch 2): the students the sender picked
 * one by one PLUS «all students of a group» sent as `group_id` — resolved here,
 * on the server, never from member lists shipped to the browser.
 *
 * A group counts only if it is an ACTIVE, live group of the sender's
 * institution (the page lists exactly those); it contributes its ACTIVE
 * STUDENTS of the SAME institution — what the old page kept of a group's
 * member ids (`recipients.some(…)`). The union is de-duplicated; the caller
 * then applies the unchanged rules of /api/mail/send (≤ MAX_RECIPIENTS per
 * request, daily cap, active student/teacher of the tenant, an address on file,
 * mail_messages log). One unit, as app_service pinned to the sender's
 * institution, AFTER getMailCaller.
 */

export const MAX_RECIPIENTS = 50
export const MAX_GROUPS = 50
// Rows read for the chosen groups' members. If this many come back, the
// distinct students are at least ROW_BOUND / MAX_GROUPS > MAX_RECIPIENTS, so
// the request is over the limit whatever the overlap — the read stays bounded.
const ROW_BOUND = MAX_RECIPIENTS * MAX_GROUPS + 1

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** De-duplicated string ids from a request body field (non-strings dropped). */
export function idList(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string'))] : []
}

export type ResolveResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: 'invalidData' | 'groupNotFound' | 'loadFailed' }

export async function resolveMailRecipients(
  tenantId: string,
  recipientIds: string[],
  groupIds: string[],
): Promise<ResolveResult> {
  if (groupIds.length === 0) return { ok: true, ids: recipientIds }
  if (groupIds.length > MAX_GROUPS || !groupIds.every(id => UUID_RE.test(id))) return { ok: false, error: 'invalidData' }

  let groups: unknown[]
  let members: { student_id: string }[]
  try {
    const rows = await run({ as: 'service', tenantId }, sql => [
      sql`select id from public.groups
           where tenant_id = ${tenantId} and is_active and deleted_at is null
             and id in (select (jsonb_array_elements_text(${sql.json(groupIds)}))::uuid)
           limit ${MAX_GROUPS}`,
      sql`select gs.student_id from public.group_students gs
            join public.users u on u.id = gs.student_id
            join public.groups g on g.id = gs.group_id
           where g.tenant_id = ${tenantId} and g.is_active and g.deleted_at is null
             and gs.group_id in (select (jsonb_array_elements_text(${sql.json(groupIds)}))::uuid)
             and u.tenant_id = ${tenantId} and u.role = 'student' and u.is_active
           limit ${ROW_BOUND}`,
    ])
    groups = rows[0]
    members = rows[1] as unknown as { student_id: string }[]
  } catch {
    return { ok: false, error: 'loadFailed' }
  }
  if (groups.length !== groupIds.length) return { ok: false, error: 'groupNotFound' }

  const ids = new Set(recipientIds)
  for (const m of members) ids.add(m.student_id)
  return { ok: true, ids: [...ids] }
}
