import { sanitizeSearch } from '@/lib/data/people'
import { run } from '@/lib/db/sql'

/**
 * The owner's report picker (/super-admin/reports, R1): the teacher, student or
 * group a report is about, found on demand inside ONE chosen institution —
 * never every institution's people preloaded into one <select>.
 *
 * Same set as the old lists, narrowed to the institution: teachers and students
 * of any status (a report on a former student is still a report), groups as RLS
 * shows them to the owner (archived ones hidden). People match by name or
 * email and come back with exactly what the picker shows (id, name, email);
 * groups by name (id, name). Runs on the owner's session, so RLS stays the
 * boundary; the institution filter is what scopes the search.
 */

/** Hard server-side cap on one search (the picker never receives more). */
export const REPORT_TARGET_LIMIT = 20

export type ReportTargetKind = 'teacher' | 'student' | 'group'
export const REPORT_TARGET_KINDS: readonly ReportTargetKind[] = ['teacher', 'student', 'group']

export interface ReportTarget { id: string; label: string; email?: string }

/**
 * The same search on the SQL layer (step 9), read as the owner — RLS stays the
 * boundary. The term is a bound parameter; sanitizeSearch already removed the
 * LIKE wildcards, so a lone `%` cannot match everyone.
 */
export async function searchReportTargetsAs(
  userId: string,
  tenantId: string,
  kind: ReportTargetKind,
  q: string,
): Promise<ReportTarget[]> {
  const search = sanitizeSearch(q)
  if (!search) return []
  const pattern = `%${search}%`
  if (kind === 'group') {
    const [rows] = await run({ as: 'user', userId }, sql => [
      sql`select id, name from public.groups
           where tenant_id = ${tenantId} and name ilike ${pattern}
           order by name, id limit ${REPORT_TARGET_LIMIT}`,
    ])
    return (rows as unknown as { id: string; name: string }[]).map(g => ({ id: g.id, label: g.name }))
  }
  const [rows] = await run({ as: 'user', userId }, sql => [
    sql`select id, full_name, email from public.users
         where tenant_id = ${tenantId} and role = ${kind} and (full_name ilike ${pattern} or email ilike ${pattern})
         order by full_name, id limit ${REPORT_TARGET_LIMIT}`,
  ])
  return (rows as unknown as { id: string; full_name: string | null; email: string | null }[])
    .map(u => ({ id: u.id, label: u.full_name ?? '', email: u.email ?? '' }))
}
