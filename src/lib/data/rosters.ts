import { run, maybeOne } from '@/lib/db/sql'
import { parsePage } from '@/lib/data/people'

/**
 * Member list of a group roster or a course's enrolments, one page at a time
 * (PERFORMANCE_CONTRACT.md P1) — RosterModal on /center/groups and
 * /center/courses (C-M). A course can hold thousands of enrolments; the modal
 * used to receive and render all of them.
 *
 * Opt-in: the membership routes use it only when the caller sends `page`
 * (rosterPageParam); without it they answer with the whole roster, because
 * /teacher/groups (T1) still reads its group's whole roster.
 *
 * Read as app_service pinned to the institution, AFTER the membership route's
 * authorization — it adds no access of its own. One statement: the total, the
 * page (a page past the end — e.g. after a removal — becomes the last page)
 * and its members.
 */

export const ROSTER_PAGE_SIZE = 50

export interface RosterMember { id: string; full_name: string; email: string }
export interface RosterPage { students: RosterMember[]; total: number; page: number; pageCount: number }

/** `?page=` when the caller asked for a page, otherwise null (= the whole roster, as before). */
export function rosterPageParam(params: URLSearchParams): number | null {
  return params.has('page') ? parsePage(params.get('page')) : null
}

/**
 * One page of a target's members, newest first (then by student id, so pages
 * never overlap), with the exact total.
 */
export async function readRosterPage(
  tenantId: string,
  kind: 'group' | 'course',
  targetId: string,
  requestedPage: number,
): Promise<RosterPage> {
  const size = ROSTER_PAGE_SIZE
  const [rows] = await run({ as: 'service', tenantId }, sql => [
    kind === 'group'
      ? sql`with total as (select count(*)::int as n from public.group_students where group_id = ${targetId}),
                 pg as (select least(${requestedPage}, greatest(1, ceil(n / ${size}::numeric)::int)) as p from total)
            select (select n from total) as total, (select p from pg) as page,
                   coalesce((select json_agg(json_build_object('id', m.id, 'full_name', m.full_name, 'email', m.email))
                               from (select u.id, u.full_name, u.email
                                       from public.group_students x join public.users u on u.id = x.student_id
                                      where x.group_id = ${targetId}
                                      order by x.joined_at desc, x.student_id
                                      limit ${size} offset ((select p from pg) - 1) * ${size}) m), '[]') as students`
      : sql`with total as (select count(*)::int as n from public.course_enrollments where course_id = ${targetId}),
                 pg as (select least(${requestedPage}, greatest(1, ceil(n / ${size}::numeric)::int)) as p from total)
            select (select n from total) as total, (select p from pg) as page,
                   coalesce((select json_agg(json_build_object('id', m.id, 'full_name', m.full_name, 'email', m.email))
                               from (select u.id, u.full_name, u.email
                                       from public.course_enrollments x join public.users u on u.id = x.student_id
                                      where x.course_id = ${targetId}
                                      order by x.enrolled_at desc, x.student_id
                                      limit ${size} offset ((select p from pg) - 1) * ${size}) m), '[]') as students`,
  ])
  const r = maybeOne<{ total: number; page: number; students: RosterMember[] }>(rows) ?? { total: 0, page: 1, students: [] }
  return { students: r.students, total: r.total, page: r.page, pageCount: Math.max(1, Math.ceil(r.total / size)) }
}
