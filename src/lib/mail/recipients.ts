import type { SupabaseClient } from '@/lib/db'

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
 * mail_messages log). Runs with the service-role client AFTER getMailCaller.
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
  admin: SupabaseClient,
  tenantId: string,
  recipientIds: string[],
  groupIds: string[],
): Promise<ResolveResult> {
  if (groupIds.length === 0) return { ok: true, ids: recipientIds }
  if (groupIds.length > MAX_GROUPS || !groupIds.every(id => UUID_RE.test(id))) return { ok: false, error: 'invalidData' }

  const { data: groups, error: gErr } = await admin
    .from('groups').select('id')
    .in('id', groupIds).eq('tenant_id', tenantId).eq('is_active', true).is('deleted_at', null)
    .limit(MAX_GROUPS)
  if (gErr) return { ok: false, error: 'loadFailed' }
  if ((groups ?? []).length !== groupIds.length) return { ok: false, error: 'groupNotFound' }

  const { data: members, error: mErr } = await admin
    .from('group_students')
    .select('student_id, users!group_students_student_id_fkey!inner(id)')
    .in('group_id', groupIds)
    .eq('users.tenant_id', tenantId)
    .eq('users.role', 'student')
    .eq('users.is_active', true)
    .limit(ROW_BOUND)
  if (mErr) return { ok: false, error: 'loadFailed' }

  const ids = new Set(recipientIds)
  for (const m of (members ?? []) as { student_id: string }[]) ids.add(m.student_id)
  return { ok: true, ids: [...ids] }
}
