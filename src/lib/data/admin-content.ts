import type { SupabaseClient } from '@/lib/db'
import { parsePage } from '@/lib/data/people'

/**
 * University-admin content feeds, bounded (Batch 3 / P-02) — the metadata-only
 * functions of supabase/content_feeds_migration.sql. The admin still never reads
 * lessons / exams directly (admin_metadata_only); these return the same columns
 * as get_admin_lessons() / get_admin_exams(), one page at a time, plus one row
 * of counts for the dashboard and the page summaries.
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

export async function loadAdminContentCounts(db: SupabaseClient): Promise<{ counts: AdminContentCounts; error: { message: string } | null }> {
  const { data, error } = await db.rpc('get_admin_content_counts')
  if (error) return { counts: ZERO, error }
  const r = ((data ?? []) as Array<Record<string, number | string>>)[0]
  if (!r) return { counts: ZERO, error: null }
  return {
    counts: {
      lessons: Number(r.lessons), publishedLessons: Number(r.published_lessons),
      exams: Number(r.exams), homework: Number(r.homework), submissions: Number(r.submissions),
    },
    error: null,
  }
}

export interface AdminPage<T> { rows: T[]; page: number; pageCount: number }

/** The page to read for `total` rows (malformed → 1, past the end → the last page). */
export function clampPage(raw: unknown, total: number, size = ADMIN_CONTENT_PAGE_SIZE): { page: number; pageCount: number; offset: number } {
  const pageCount = Math.max(1, Math.ceil(total / size))
  const page = Math.min(parsePage(raw), pageCount)
  return { page, pageCount, offset: (page - 1) * size }
}

export interface AdminLessonRow {
  id: string; title: string; is_published: boolean; created_at: string; teacher_name: string | null; group_name: string | null
}

/** One page of the lesson feed; `total` comes from loadAdminContentCounts (no extra count query). */
export async function loadAdminLessonsPage(db: SupabaseClient, raw: unknown, total: number, limit = ADMIN_CONTENT_PAGE_SIZE) {
  const { page, pageCount, offset } = clampPage(raw, total, limit)
  const { data, error } = await db.rpc('get_admin_lessons_page', { p_limit: limit, p_offset: offset })
  const rows: AdminLessonRow[] = ((data ?? []) as AdminLessonRow[]).map(r => ({
    id: r.id, title: r.title, is_published: r.is_published, created_at: r.created_at, teacher_name: r.teacher_name, group_name: r.group_name,
  }))
  return { data: { rows, page, pageCount } as AdminPage<AdminLessonRow>, error }
}

export interface AdminExamRow {
  id: string; title: string; type: string | null; duration_minutes: number; is_published: boolean
  proctoring_enabled: boolean; created_at: string; teacher_name: string | null; group_name: string | null; submission_count: number
}

/** One page of exams (homework = false) or homework (homework = true). */
export async function loadAdminExamsPage(db: SupabaseClient, homework: boolean, raw: unknown, total: number) {
  const { page, pageCount, offset } = clampPage(raw, total)
  const { data, error } = await db.rpc('get_admin_exams_page', { p_homework: homework, p_limit: ADMIN_CONTENT_PAGE_SIZE, p_offset: offset })
  const rows: AdminExamRow[] = ((data ?? []) as AdminExamRow[]).map(r => ({
    id: r.id, title: r.title, type: r.type, duration_minutes: r.duration_minutes, is_published: r.is_published,
    proctoring_enabled: r.proctoring_enabled, created_at: r.created_at, teacher_name: r.teacher_name, group_name: r.group_name,
    submission_count: Number(r.submission_count ?? 0),
  }))
  return { data: { rows, page, pageCount } as AdminPage<AdminExamRow>, error }
}
