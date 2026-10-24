import { run, type Sql } from '@/lib/db/sql'
import { parsePage } from '@/lib/data/people'

/**
 * The admin's metadata-only content feeds (step 9): the SECURITY DEFINER
 * functions get_admin_content_counts / get_admin_lessons_page /
 * get_admin_exams_page, read as the admin. They return titles, teachers,
 * groups, status and counts — never lesson bodies, questions or answers.
 */

export const ADMIN_CONTENT_PAGE_SIZE = 50

export interface AdminContentCounts {
  lessons: number
  publishedLessons: number
  exams: number
  homework: number
  submissions: number
}

const ZERO: AdminContentCounts = { lessons: 0, publishedLessons: 0, exams: 0, homework: 0, submissions: 0 }

export async function loadAdminContentCounts(userId: string): Promise<{ counts: AdminContentCounts; error: { message: string } | null }> {
  try {
    const [rows] = await run({ as: 'user', userId }, sql => [sql`select * from public.get_admin_content_counts()`])
    const r = rows[0] as Record<string, number | string> | undefined
    if (!r) return { counts: ZERO, error: null }
    return {
      counts: {
        lessons: Number(r.lessons), publishedLessons: Number(r.published_lessons),
        exams: Number(r.exams), homework: Number(r.homework), submissions: Number(r.submissions),
      },
      error: null,
    }
  } catch (e) {
    return { counts: ZERO, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

export interface AdminPage<T> { rows: T[]; page: number; pageCount: number }

export function clampPage(raw: unknown, total: number, size = ADMIN_CONTENT_PAGE_SIZE): { page: number; pageCount: number; offset: number } {
  const pageCount = Math.max(1, Math.ceil(total / size))
  const page = Math.min(parsePage(raw), pageCount)
  return { page, pageCount, offset: (page - 1) * size }
}

export interface AdminLessonRow {
  id: string; title: string; is_published: boolean; created_at: string; teacher_name: string | null; group_name: string | null
}

export async function loadAdminLessonsPage(userId: string, raw: unknown, total: number, limit = ADMIN_CONTENT_PAGE_SIZE) {
  const { page, pageCount, offset } = clampPage(raw, total, limit)
  try {
    const [rows] = await run({ as: 'user', userId }, sql => [
      sql`select id, title, is_published, created_at, teacher_name, group_name from public.get_admin_lessons_page(${limit}, ${offset})`,
    ])
    const out: AdminLessonRow[] = (rows as unknown as AdminLessonRow[]).map(r => ({
      id: r.id, title: r.title, is_published: r.is_published, created_at: r.created_at, teacher_name: r.teacher_name, group_name: r.group_name,
    }))
    return { data: { rows: out, page, pageCount } as AdminPage<AdminLessonRow>, error: null }
  } catch (e) {
    return { data: { rows: [], page, pageCount } as AdminPage<AdminLessonRow>, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

export interface AdminExamRow {
  id: string; title: string; type: string | null; duration_minutes: number; is_published: boolean
  proctoring_enabled: boolean; created_at: string; teacher_name: string | null; group_name: string | null; submission_count: number
}

export async function loadAdminExamsPage(userId: string, homework: boolean, raw: unknown, total: number) {
  const { page, pageCount, offset } = clampPage(raw, total)
  try {
    const [rows] = await run({ as: 'user', userId }, (sql: Sql) => [
      sql`select * from public.get_admin_exams_page(${homework}, ${ADMIN_CONTENT_PAGE_SIZE}, ${offset})`,
    ])
    const out: AdminExamRow[] = (rows as unknown as AdminExamRow[]).map(r => ({
      id: r.id, title: r.title, type: r.type, duration_minutes: r.duration_minutes, is_published: r.is_published,
      proctoring_enabled: r.proctoring_enabled, created_at: r.created_at, teacher_name: r.teacher_name, group_name: r.group_name,
      submission_count: Number(r.submission_count ?? 0),
    }))
    return { data: { rows: out, page, pageCount } as AdminPage<AdminExamRow>, error: null }
  } catch (e) {
    return { data: { rows: [], page, pageCount } as AdminPage<AdminExamRow>, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}
