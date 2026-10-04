import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePage } from '@/lib/data/people'
import { IncompleteReadError, readAllPages, rowsOf, type ReadResult } from '@/lib/data/complete-read'

// ── /center/groups (B, absorbs F1) ──────────────────────────────────────────
//
// The institution's groups, read through the centre manager's session (RLS:
// groups_select — own tenant, not deleted), plus the same explicit tenant filter
// as before. The table is one server page (newest first, `id` breaks ties so
// pages never overlap or skip); the active / archived totals are head counts;
// and the transfer picker gets every ACTIVE group of the institution, read
// completely in counted pages — not just the groups on the current page. A
// failed or short read throws (IncompleteReadError), never a partial screen.

export const CENTER_GROUPS_PAGE_SIZE = 50
const RANGE_NOT_SATISFIABLE = 'PGRST103'

/** What the transfer picker shows: name, course, cap and current size. */
const TRANSFER_OPTION_COLUMNS = 'id, name, course_id, max_students, group_students(count)'

export interface TransferOptionRow {
  id: string; name: string; course_id: string | null; max_students: number | null
  group_students: { count: number }[] | null
}

function countOf(r: ReadResult, what: string): number {
  if (r.error) throw new IncompleteReadError(`${what}: count failed`, r.error)
  if (r.count == null) throw new IncompleteReadError(`${what}: no count returned`)
  return r.count
}

export async function loadCenterGroupsPage(db: SupabaseClient, tenantId: string, rawPage: unknown) {
  const pageOf = (page: number) => {
    const from = (page - 1) * CENTER_GROUPS_PAGE_SIZE
    // Exactly the columns the table uses (was `*`; the optional course / image / cap columns
    // exist since group_course_transfer_migration.sql, which the picker below also reads).
    return db.from('groups')
      .select('id, name, description, is_active, teacher_id, course_id, image_url, max_students, instructions, group_students(count), teacher:users!groups_teacher_id_fkey(full_name, role, is_active)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, from + CENTER_GROUPS_PAGE_SIZE - 1)
  }

  let page = parsePage(rawPage)
  const [first, activeRes, archivedRes, transferOptions] = await Promise.all([
    pageOf(page),
    db.from('groups').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true),
    db.from('groups').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', false),
    readAllPages<TransferOptionRow>('transfer groups', (from, to, withCount) => db.from('groups')
      .select(TRANSFER_OPTION_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .eq('tenant_id', tenantId).eq('is_active', true)
      .order('name').order('id').range(from, to)),
  ])
  const active = countOf(activeRes, 'active groups')
  const archived = countOf(archivedRes, 'archived groups')

  let res = first
  if (res.error?.code === RANGE_NOT_SATISFIABLE) {
    // A page past the end (e.g. after an archive or a stale link): serve the last page.
    page = Math.max(1, Math.ceil((active + archived) / CENTER_GROUPS_PAGE_SIZE))
    res = await pageOf(page)
  }
  const rows = rowsOf(res as ReadResult, 'groups page')
  const total = countOf(res as ReadResult, 'groups page')
  return {
    rows, page, total, active, archived, transferOptions,
    pageCount: Math.max(1, Math.ceil(total / CENTER_GROUPS_PAGE_SIZE)),
  }
}
