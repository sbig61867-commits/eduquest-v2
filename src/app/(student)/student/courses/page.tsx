export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { redirect } from 'next/navigation'
import { loadStudentCourseList } from '@/lib/data/student-courses'
import { StudentCoursesClient } from './courses-client'

export default async function StudentCoursesPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const { courses, progressMap, groupsByCourse, pastCourses } = await loadStudentCourseList(user.id)

  return (
    <StudentCoursesClient
      courses={courses}
      progressMap={progressMap}
      groupsByCourse={groupsByCourse}
      pastCourses={pastCourses}
    />
  )
}
