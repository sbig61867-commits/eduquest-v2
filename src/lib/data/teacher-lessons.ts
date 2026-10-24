import { run, maybeOne } from '@/lib/db/sql'
import { parsePage } from '@/lib/data/people'
import { lessonPlainText } from '@/lib/lesson-doc'

/**
 * /teacher/lessons (Batch 3 / P-03): a teacher's lessons one page at a time,
 * newest first, with the total from the database. The list only ever showed
 * a 150-character excerpt of each lesson, so the content is cut down HERE, on
 * the server — the browser receives the excerpt, never the lesson bodies. The
 * full content is read on demand when the teacher opens «Edit».
 * Read as the teacher (RLS); the teacher filter is the page's own. One
 * statement: the total, the page (a page past the end becomes the last page)
 * and its rows.
 */

export const TEACHER_LESSONS_PAGE_SIZE = 50

/** What the list shows of a lesson's content (unchanged from the old client: markdown marks removed, 150 chars). */
export function lessonExcerpt(content: string | null | undefined): string {
  return content ? lessonPlainText(content).slice(0, 150) : ''
}

export interface TeacherLessonRow {
  id: string
  title: string
  is_published: boolean
  created_at: string
  excerpt: string
  groups: { name: string } | null
}

export interface TeacherLessonsPage { rows: TeacherLessonRow[]; total: number; page: number; pageCount: number }

type Raw = Omit<TeacherLessonRow, 'excerpt'> & { content: string | null }

/** A lesson row as the list keeps it (also used for rows returned by POST / PATCH /api/lessons). */
export function toLessonRow(l: Raw): TeacherLessonRow {
  return { id: l.id, title: l.title, is_published: l.is_published, created_at: l.created_at, excerpt: lessonExcerpt(l.content), groups: l.groups }
}

export async function loadTeacherLessons(
  teacherId: string,
  rawPage: unknown,
): Promise<{ data: TeacherLessonsPage; error: { message: string } | null }> {
  const size = TEACHER_LESSONS_PAGE_SIZE
  try {
    const [rows] = await run({ as: 'user', userId: teacherId }, sql => [
      sql`with total as (select count(*)::int as n from public.lessons where teacher_id = ${teacherId}),
               pg as (select least(${parsePage(rawPage)}, greatest(1, ceil(n / ${size}::numeric)::int)) as p from total)
          select (select n from total) as total, (select p from pg) as page,
                 coalesce((select json_agg(json_build_object('id', x.id, 'title', x.title, 'is_published', x.is_published,
                                   'created_at', x.created_at, 'content', x.content,
                                   'groups', case when x.group_name is null then null else json_build_object('name', x.group_name) end))
                             from (select l.id, l.title, l.is_published, l.created_at, l.content, g.name as group_name
                                     from public.lessons l left join public.groups g on g.id = l.group_id
                                    where l.teacher_id = ${teacherId}
                                    order by l.created_at desc, l.id
                                    limit ${size} offset ((select p from pg) - 1) * ${size}) x), '[]') as rows`,
    ])
    const r = maybeOne<{ total: number; page: number; rows: Raw[] }>(rows) ?? { total: 0, page: 1, rows: [] }
    return { data: { rows: r.rows.map(toLessonRow), total: r.total, page: r.page, pageCount: Math.max(1, Math.ceil(r.total / size)) }, error: null }
  } catch (e) {
    return { data: { rows: [], total: 0, page: 1, pageCount: 1 }, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}
