import { run } from '@/lib/db/sql'
import type { CourseGroup, PastCourse } from '@/app/(student)/student/courses/courses-client'

/**
 * The student's course list (/student/courses) — PERFORMANCE_CONTRACT.md P2, P5, P6.
 *
 * Named columns only (courses.source_text — the whole file a course was built
 * from — never reaches a card). ONE unit, read as the student (RLS-scoped):
 * enrolments, transfers out of a course, the course sections the student is in,
 * the published courses and each course's progress (get_course_progress per
 * enrolled course, in the same statement — no N extra calls).
 */

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

const LIST_LIMIT = 500

export async function loadStudentCourseList(studentId: string): Promise<StudentCourseList> {
  const [enrollments, transfers, sections, courses] = await run({ as: 'user', userId: studentId }, sql => [
    sql`select course_id from public.course_enrollments where student_id = ${studentId} limit ${LIST_LIMIT}`,
    // Courses left through a group transfer: progress frozen at the moment of
    // the move. Read-only history.
    sql`select id, from_course_id, from_course_title, from_group_name, to_course_title, frozen_completed, frozen_total, created_at
          from public.group_transfers
         where student_id = ${studentId} and course_changed
         order by created_at desc limit ${LIST_LIMIT}`,
    // The student's ACTIVE groups that are sections of a course they are enrolled in.
    sql`select g.id, g.name, g.course_id, g.image_url, g.instructions
          from public.group_students gs join public.groups g on g.id = gs.group_id
         where gs.student_id = ${studentId} and g.is_active and g.course_id is not null
           and g.course_id in (select course_id from public.course_enrollments where student_id = ${studentId})
         limit ${LIST_LIMIT}`,
    sql`select c.id, c.title, c.description, c.language, c.has_levels,
               case when t.id is null then null else json_build_object('full_name', t.full_name) end as users,
               public.get_course_progress(c.id, ${studentId}) as progress
          from public.courses c left join public.users t on t.id = c.teacher_id
         where c.is_published and c.id in (select course_id from public.course_enrollments where student_id = ${studentId})
         order by c.title limit ${LIST_LIMIT}`,
  ])

  const courseIds = (enrollments as unknown as { course_id: string }[]).map(e => e.course_id)
  const pastCourses = (transfers as unknown as PastCourse[])
    // Back in that course again later? Then it is a current course, not history.
    .filter(t => !t.from_course_id || !courseIds.includes(t.from_course_id))
  if (courseIds.length === 0) return { courses: [], progressMap: {}, groupsByCourse: {}, pastCourses }

  const groupsByCourse: Record<string, CourseGroup[]> = {}
  for (const g of sections as unknown as { id: string; name: string; course_id: string; image_url: string | null; instructions: string | null }[]) {
    ;(groupsByCourse[g.course_id] ??= []).push({ id: g.id, name: g.name, image_url: g.image_url, instructions: g.instructions })
  }

  const rows = courses as unknown as (StudentCourseCard & { progress: CourseProgress | null })[]
  // Every enrolled course has a progress entry (null for one that is not published), as before.
  const progressMap: Record<string, CourseProgress | null> = Object.fromEntries(courseIds.map(id => [id, null]))
  for (const c of rows) progressMap[c.id] = c.progress
  return {
    courses: rows.map(({ progress: _p, ...card }) => (void _p, card)),
    progressMap,
    groupsByCourse,
    pastCourses,
  }
}
