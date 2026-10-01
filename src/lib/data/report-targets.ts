import type { SupabaseClient } from '@supabase/supabase-js'
import { nameOrEmailFilter, sanitizeSearch } from '@/lib/data/people'

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

export async function searchReportTargets(
  db: SupabaseClient,
  tenantId: string,
  kind: ReportTargetKind,
  q: string,
): Promise<{ rows: ReportTarget[]; error: { message: string } | null }> {
  const search = sanitizeSearch(q)
  if (!search) return { rows: [], error: null }

  if (kind === 'group') {
    const { data, error } = await db
      .from('groups')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .ilike('name', `%${search}%`)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .limit(REPORT_TARGET_LIMIT)
    if (error) return { rows: [], error }
    const rows = ((data ?? []) as { id: string; name: string }[])
      .slice(0, REPORT_TARGET_LIMIT)
      .map(g => ({ id: g.id, label: g.name }))
    return { rows, error: null }
  }

  const { data, error } = await db
    .from('users')
    .select('id, full_name, email')
    .eq('tenant_id', tenantId)
    .eq('role', kind)
    .or(nameOrEmailFilter(search))
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(REPORT_TARGET_LIMIT)
  if (error) return { rows: [], error }
  const rows = ((data ?? []) as { id: string; full_name: string | null; email: string | null }[])
    .slice(0, REPORT_TARGET_LIMIT)
    .map(u => ({ id: u.id, label: u.full_name ?? '', email: u.email ?? '' }))
  return { rows, error: null }
}
