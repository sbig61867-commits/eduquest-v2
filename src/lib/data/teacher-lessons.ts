// Pure on purpose: the lessons list (a browser component) imports toLessonRow.
// The database read is in src/lib/data/teacher-lessons-load.ts (server only).
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

export type Raw = Omit<TeacherLessonRow, 'excerpt'> & { content: string | null }

/** A lesson row as the list keeps it (also used for rows returned by POST / PATCH /api/lessons). */
export function toLessonRow(l: Raw): TeacherLessonRow {
  return { id: l.id, title: l.title, is_published: l.is_published, created_at: l.created_at, excerpt: lessonExcerpt(l.content), groups: l.groups }
}
