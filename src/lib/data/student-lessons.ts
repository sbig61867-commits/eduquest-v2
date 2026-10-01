import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePage } from '@/lib/data/people'

/**
 * /student/lessons (Batch 3 / P-05): the published lessons of the student's
 * active groups one page at a time, newest first, WITHOUT their bodies — the
 * page used to read and render every lesson body at once. A body is read when
 * the student opens that lesson (components/student/lesson-details.tsx).
 * Runs on the student's session: RLS allows only published lessons of their
 * own groups; the active-group filter is the page's own, unchanged.
 */

export const STUDENT_LESSONS_PAGE_SIZE = 50

/** PostgREST: the requested range starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

export interface StudentLessonRow {
  id: string
  title: string
  created_at: string
  group_id: string
  groups: { name: string } | null
}

export interface StudentLessonsPage { rows: StudentLessonRow[]; total: number; page: number; pageCount: number }

export async function loadStudentLessons(
  db: SupabaseClient,
  groupIds: string[],
  rawPage: unknown,
): Promise<{ data: StudentLessonsPage; error: { message: string } | null }> {
  const empty: StudentLessonsPage = { rows: [], total: 0, page: 1, pageCount: 1 }
  if (groupIds.length === 0) return { data: empty, error: null }

  const fetchPage = (page: number) => {
    const from = (page - 1) * STUDENT_LESSONS_PAGE_SIZE
    // groups!inner + is_active: lessons of archived groups are hidden (as before).
    return db.from('lessons').select('id, title, created_at, group_id, groups!inner(name, is_active)', { count: 'exact' })
      .eq('is_published', true).eq('groups.is_active', true).in('group_id', groupIds)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, from + STUDENT_LESSONS_PAGE_SIZE - 1)
  }

  let page = parsePage(rawPage)
  let res = await fetchPage(page)
  if (res.error?.code === RANGE_NOT_SATISFIABLE) {
    const { count } = await db.from('lessons').select('id, groups!inner(is_active)', { count: 'exact', head: true })
      .eq('is_published', true).eq('groups.is_active', true).in('group_id', groupIds)
    page = Math.max(1, Math.ceil((count ?? 0) / STUDENT_LESSONS_PAGE_SIZE))
    res = await fetchPage(page)
  }
  if (res.error) return { data: empty, error: res.error }
  const total = res.count ?? 0
  const rows = ((res.data ?? []) as unknown as Array<StudentLessonRow & { groups: { name: string; is_active: boolean } | null }>)
    .map(({ id, title, created_at, group_id, groups }) => ({ id, title, created_at, group_id, groups: groups ? { name: groups.name } : null }))
  return { data: { rows, total, page, pageCount: Math.max(1, Math.ceil(total / STUDENT_LESSONS_PAGE_SIZE)) }, error: null }
}
