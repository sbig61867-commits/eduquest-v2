import { run, maybeOne } from '@/lib/db/sql'
import { parsePage } from '@/lib/data/people'

/**
 * /student/lessons (Batch 3 / P-05): the published lessons of the student's
 * active groups one page at a time, newest first, WITHOUT their bodies — the
 * page used to read and render every lesson body at once. A body is read when
 * the student opens that lesson (components/student/lesson-details.tsx).
 * Read as the student: RLS allows only published lessons of their own groups;
 * the active-group filter is the page's own. One statement: the total, the
 * page (a page past the end becomes the last page) and its rows.
 */

export const STUDENT_LESSONS_PAGE_SIZE = 50

export interface StudentLessonRow {
  id: string
  title: string
  created_at: string
  group_id: string
  groups: { name: string } | null
}

export interface StudentLessonsPage { rows: StudentLessonRow[]; total: number; page: number; pageCount: number }

export async function loadStudentLessons(
  userId: string,
  groupIds: string[],
  rawPage: unknown,
): Promise<{ data: StudentLessonsPage; error: { message: string } | null }> {
  const empty: StudentLessonsPage = { rows: [], total: 0, page: 1, pageCount: 1 }
  if (groupIds.length === 0) return { data: empty, error: null }
  const size = STUDENT_LESSONS_PAGE_SIZE
  try {
    const [rows] = await run({ as: 'user', userId }, sql => [
      sql`with visible as (
            select l.id, l.title, l.created_at, l.group_id, g.name as group_name
              from public.lessons l join public.groups g on g.id = l.group_id
             where l.is_published and g.is_active
               and l.group_id in (select (jsonb_array_elements_text(${sql.json(groupIds)}))::uuid)
          ), total as (select count(*)::int as n from visible),
          pg as (select least(${parsePage(rawPage)}, greatest(1, ceil(n / ${size}::numeric)::int)) as p from total)
          select (select n from total) as total, (select p from pg) as page,
                 coalesce((select json_agg(json_build_object('id', v.id, 'title', v.title, 'created_at', v.created_at,
                                   'group_id', v.group_id, 'groups', json_build_object('name', v.group_name)))
                             from (select * from visible order by created_at desc, id
                                   limit ${size} offset ((select p from pg) - 1) * ${size}) v), '[]') as rows`,
    ])
    const r = maybeOne<{ total: number; page: number; rows: StudentLessonRow[] }>(rows) ?? { total: 0, page: 1, rows: [] }
    return { data: { rows: r.rows, total: r.total, page: r.page, pageCount: Math.max(1, Math.ceil(r.total / size)) }, error: null }
  } catch (e) {
    return { data: empty, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}
