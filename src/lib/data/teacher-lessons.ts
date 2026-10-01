import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePage } from '@/lib/data/people'

/**
 * /teacher/lessons (Batch 3 / P-03): a teacher's lessons one page at a time,
 * newest first, with the total from the database. The list only ever showed
 * a 150-character excerpt of each lesson, so the content is cut down HERE, on
 * the server — the browser receives the excerpt, never the lesson bodies. The
 * full content is read on demand when the teacher opens «Edit».
 * Runs on the teacher's session (RLS); the teacher filter is the page's own.
 */

export const TEACHER_LESSONS_PAGE_SIZE = 50

/** PostgREST: the requested range starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

/** What the list shows of a lesson's content (unchanged from the old client: markdown marks removed, 150 chars). */
export function lessonExcerpt(content: string | null | undefined): string {
  return content ? content.replace(/[#*`]/g, '').slice(0, 150) : ''
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
  db: SupabaseClient,
  teacherId: string,
  rawPage: unknown,
): Promise<{ data: TeacherLessonsPage; error: { message: string } | null }> {
  const fetchPage = (page: number) => {
    const from = (page - 1) * TEACHER_LESSONS_PAGE_SIZE
    return db.from('lessons').select('id, title, is_published, created_at, content, groups(name)', { count: 'exact' })
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, from + TEACHER_LESSONS_PAGE_SIZE - 1)
  }

  let page = parsePage(rawPage)
  let res = await fetchPage(page)
  if (res.error?.code === RANGE_NOT_SATISFIABLE) {
    const { count } = await db.from('lessons').select('id', { count: 'exact', head: true }).eq('teacher_id', teacherId)
    page = Math.max(1, Math.ceil((count ?? 0) / TEACHER_LESSONS_PAGE_SIZE))
    res = await fetchPage(page)
  }
  if (res.error) return { data: { rows: [], total: 0, page: 1, pageCount: 1 }, error: res.error }
  const total = res.count ?? 0
  return {
    data: {
      rows: ((res.data ?? []) as unknown as Raw[]).map(toLessonRow),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / TEACHER_LESSONS_PAGE_SIZE)),
    },
    error: null,
  }
}
