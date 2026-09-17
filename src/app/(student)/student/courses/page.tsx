export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentCoursesClient, type CourseGroup, type PastCourse } from './courses-client'

export default async function StudentCoursesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Get enrolled course IDs
  const { data: enrollments } = await supabase
    .from('course_enrollments')
    .select('course_id, enrolled_at')
    .eq('student_id', user.id)

  const courseIds = (enrollments ?? []).map(e => e.course_id)

  // Courses left through a group transfer: progress frozen at the moment of the
  // move (group_transfers). Read-only history — errors (pre-migration) mean none.
  const { data: transfers } = await supabase
    .from('group_transfers')
    .select('id, from_course_id, from_course_title, from_group_name, to_course_title, frozen_completed, frozen_total, created_at')
    .eq('student_id', user.id)
    .eq('course_changed', true)
    .order('created_at', { ascending: false })
  const pastCourses: PastCourse[] = ((transfers ?? []) as PastCourse[])
    // Back in that course again later? Then it is a current course, not history.
    .filter(t => !t.from_course_id || !courseIds.includes(t.from_course_id))

  if (courseIds.length === 0) {
    return <StudentCoursesClient courses={[]} progressMap={{}} groupsByCourse={{}} pastCourses={pastCourses} />
  }

  // The student's groups that are sections of these courses. A group shows under
  // a course only when it is linked to that course AND the student is a member.
  const { data: memberships } = await supabase
    .from('group_students')
    .select('groups(*)')
    .eq('student_id', user.id)
  type GroupRow = { id: string; name: string; course_id?: string | null; image_url?: string | null; instructions?: string | null; is_active?: boolean }
  const groupsByCourse: Record<string, CourseGroup[]> = {}
  for (const m of (memberships ?? []) as unknown as { groups: GroupRow | GroupRow[] | null }[]) {
    const g = Array.isArray(m.groups) ? m.groups[0] : m.groups
    if (!g?.course_id || !courseIds.includes(g.course_id) || g.is_active === false) continue
    ;(groupsByCourse[g.course_id] ??= []).push({
      id: g.id, name: g.name, image_url: g.image_url ?? null, instructions: g.instructions ?? null,
    })
  }

  const { data: courses } = await supabase
    .from('courses')
    .select('*, users!courses_teacher_id_fkey(full_name)')
    .in('id', courseIds)
    .eq('is_published', true)
    .order('title')

  // Fetch progress for each course
  const progressResults = await Promise.all(
    courseIds.map(async (cid) => {
      const { data } = await supabase.rpc('get_course_progress', {
        p_course_id: cid,
        p_student_id: user.id,
      })
      return [cid, data] as const
    })
  )
  const progressMap = Object.fromEntries(progressResults)

  return (
    <StudentCoursesClient
      courses={courses ?? []}
      progressMap={progressMap}
      groupsByCourse={groupsByCourse}
      pastCourses={pastCourses}
    />
  )
}
