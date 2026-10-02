export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { loadStudentCourseList } from '@/lib/data/student-courses'
import { StudentCoursesClient } from './courses-client'

export default async function StudentCoursesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { courses, progressMap, groupsByCourse, pastCourses } = await loadStudentCourseList(supabase, user.id)

  return (
    <StudentCoursesClient
      courses={courses}
      progressMap={progressMap}
      groupsByCourse={groupsByCourse}
      pastCourses={pastCourses}
    />
  )
}
