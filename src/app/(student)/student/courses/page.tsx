export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentCoursesClient } from './courses-client'

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

  if (courseIds.length === 0) {
    return <StudentCoursesClient courses={[]} progressMap={{}} />
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

  return <StudentCoursesClient courses={courses ?? []} progressMap={progressMap} />
}
