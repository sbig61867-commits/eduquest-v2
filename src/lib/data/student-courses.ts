import type { SupabaseClient } from '@supabase/supabase-js'
import type { CourseGroup, PastCourse } from '@/app/(student)/student/courses/courses-client'

/**
 * The student's course list (/student/courses) — PERFORMANCE_CONTRACT.md P2, P5, P6.
 *
 * Named columns only: courses.* carried source_text (the whole file a course was
 * built from) to every card, and groups(*) every group column. Two rounds instead
 * of four plus N: enrolments, transfers and group memberships do not depend on each
 * other; the courses and their progress depend only on the enrolled course ids.
 *
 * Every read is the student's own (student_id = the caller, RLS-scoped as well), so
 * each is bounded by the student's enrolments / memberships / transfers.
 */
export const STUDENT_COURSE_COLUMNS = 'id, title, description, language, has_levels, users!courses_teacher_id_fkey(full_name)'
export const STUDENT_GROUP_COLUMNS = 'groups(id, name, course_id, image_url, instructions, is_active)'

export interface StudentCourseCard {
  id: string
  title: string
  description: string | null
  language: string | null
  has_levels: boolean
  users: { full_name: string } | null
}

export interface CourseProgress { total: number; completed: number; percent: number }

export interface StudentCourseList {
  courses: StudentCourseCard[]
  progressMap: Record<string, CourseProgress | null>
  groupsByCourse: Record<string, CourseGroup[]>
  pastCourses: PastCourse[]
}

type GroupRow = { id: string; name: string; course_id?: string | null; image_url?: string | null; instructions?: string | null; is_active?: boolean }

export async function loadStudentCourseList(db: SupabaseClient, studentId: string): Promise<StudentCourseList> {
  const [{ data: enrollments }, { data: transfers }, { data: memberships }] = await Promise.all([
    db.from('course_enrollments').select('course_id').eq('student_id', studentId),
    // Courses left through a group transfer: progress frozen at the moment of the
    // move (group_transfers). Read-only history — errors (pre-migration) mean none.
    db.from('group_transfers')
      .select('id, from_course_id, from_course_title, from_group_name, to_course_title, frozen_completed, frozen_total, created_at')
      .eq('student_id', studentId)
      .eq('course_changed', true)
      .order('created_at', { ascending: false }),
    // The student's groups that are sections of these courses.
    db.from('group_students').select(STUDENT_GROUP_COLUMNS).eq('student_id', studentId),
  ])

  const courseIds = (enrollments ?? []).map(e => e.course_id as string)

  const pastCourses: PastCourse[] = ((transfers ?? []) as PastCourse[])
    // Back in that course again later? Then it is a current course, not history.
    .filter(t => !t.from_course_id || !courseIds.includes(t.from_course_id))

  if (courseIds.length === 0) return { courses: [], progressMap: {}, groupsByCourse: {}, pastCourses }

  // A group shows under a course only when it is linked to that course AND the
  // student is a member.
  const groupsByCourse: Record<string, CourseGroup[]> = {}
  for (const m of (memberships ?? []) as unknown as { groups: GroupRow | GroupRow[] | null }[]) {
    const g = Array.isArray(m.groups) ? m.groups[0] : m.groups
    if (!g?.course_id || !courseIds.includes(g.course_id) || g.is_active === false) continue
    ;(groupsByCourse[g.course_id] ??= []).push({
      id: g.id, name: g.name, image_url: g.image_url ?? null, instructions: g.instructions ?? null,
    })
  }

  const [{ data: courses }, progressResults] = await Promise.all([
    db.from('courses')
      .select(STUDENT_COURSE_COLUMNS)
      .in('id', courseIds)
      .eq('is_published', true)
      .order('title'),
    Promise.all(courseIds.map(async (cid) => {
      const { data } = await db.rpc('get_course_progress', { p_course_id: cid, p_student_id: studentId })
      return [cid, data as CourseProgress | null] as const
    })),
  ])

  return {
    courses: (courses ?? []) as unknown as StudentCourseCard[],
    progressMap: Object.fromEntries(progressResults),
    groupsByCourse,
    pastCourses,
  }
}
