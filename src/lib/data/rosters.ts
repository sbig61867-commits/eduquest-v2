import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePage } from '@/lib/data/people'

/**
 * Member list of a group roster or a course's enrolments, one page at a time
 * (PERFORMANCE_CONTRACT.md P1) — RosterModal on /center/groups and
 * /center/courses (C-M). A course can hold thousands of enrolments; the modal
 * used to receive and render all of them.
 *
 * Opt-in: the membership routes use it only when the caller sends `page`
 * (rosterPageParam); without it they answer exactly as before, because
 * /teacher/groups (T1) still reads its group's whole roster.
 *
 * Runs with the service-role client the membership routes already use for this
 * read, AFTER their authorization — it adds no access of its own.
 */

export const ROSTER_PAGE_SIZE = 50

/** PostgREST: the requested range starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

const ROSTERS = {
  group: { table: 'group_students', key: 'group_id', fk: 'group_students_student_id_fkey', joined: 'joined_at' },
  course: { table: 'course_enrollments', key: 'course_id', fk: 'course_enrollments_student_id_fkey', joined: 'enrolled_at' },
} as const

export interface RosterMember { id: string; full_name: string; email: string }
export interface RosterPage { students: RosterMember[]; total: number; page: number; pageCount: number }

/** `?page=` when the caller asked for a page, otherwise null (= the whole roster, as before). */
export function rosterPageParam(params: URLSearchParams): number | null {
  return params.has('page') ? parsePage(params.get('page')) : null
}

type Row = { users: RosterMember | RosterMember[] | null }
const toMembers = (rows: unknown[] | null): RosterMember[] =>
  ((rows ?? []) as Row[]).map(r => (Array.isArray(r.users) ? r.users[0] : r.users)).filter((u): u is RosterMember => !!u)

/**
 * One page of a target's members, newest first (then by student id, so pages
 * never overlap), with the exact total. A page past the end (e.g. after a
 * removal) is answered with the last page.
 */
export async function readRosterPage(
  admin: SupabaseClient,
  kind: keyof typeof ROSTERS,
  targetId: string,
  requestedPage: number,
): Promise<{ data: RosterPage; error: { message: string } | null }> {
  const r = ROSTERS[kind]
  const fetchPage = (page: number) => {
    const from = (page - 1) * ROSTER_PAGE_SIZE
    return admin
      .from(r.table)
      .select(`student_id, users!${r.fk}(id, full_name, email)`, { count: 'exact' })
      .eq(r.key, targetId)
      .order(r.joined, { ascending: false })
      .order('student_id', { ascending: true })
      .range(from, from + ROSTER_PAGE_SIZE - 1)
  }

  let page = requestedPage
  let res = await fetchPage(page)
  if (res.error?.code === RANGE_NOT_SATISFIABLE) {
    const { count } = await admin.from(r.table).select('student_id', { count: 'exact', head: true }).eq(r.key, targetId)
    page = Math.max(1, Math.ceil((count ?? 0) / ROSTER_PAGE_SIZE))
    res = await fetchPage(page)
  }
  if (res.error) return { data: { students: [], total: 0, page: 1, pageCount: 1 }, error: res.error }
  const total = res.count ?? 0
  return {
    data: { students: toMembers(res.data), total, page, pageCount: Math.max(1, Math.ceil(total / ROSTER_PAGE_SIZE)) },
    error: null,
  }
}
