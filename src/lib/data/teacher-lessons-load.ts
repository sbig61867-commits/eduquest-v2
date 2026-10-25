import { run, maybeOne } from '@/lib/db/sql'
import { parsePage } from '@/lib/data/people'
import { TEACHER_LESSONS_PAGE_SIZE, toLessonRow, type Raw, type TeacherLessonsPage } from '@/lib/data/teacher-lessons'

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
