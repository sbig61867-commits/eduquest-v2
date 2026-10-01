export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/shared/no-permission'
import { CenterCoursesClient, type CenterCourseRow } from '@/components/center/courses-client'
import { activeTeacherName, type EmbeddedTeacher } from '@/lib/data/people'

interface RawCourse {
  id: string
  title: string
  description: string | null
  is_published: boolean
  teacher_id: string
  course_units: { count: number }[] | null
  course_enrollments: { count: number }[] | null
  teacher: EmbeddedTeacher | EmbeddedTeacher[] | null
}

export default async function CenterCoursesPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_courses')) return <NoPermission capability="manage_courses" />

  // Teachers are found on demand (/api/teachers/search, ≤ 20 per search); the page
  // only needs each course's teacher name and whether any active teacher exists.
  // Students to enrol are found on demand in RosterModal (/api/roster/candidates, ≤ 20).
  const [{ data: courses, error }, { count: activeTeachers }] = await Promise.all([
    supabase.from('courses')
      .select('id, title, description, is_published, teacher_id, course_units(count), course_enrollments(count), teacher:users!courses_teacher_id_fkey(full_name, role, is_active)')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('users').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('role', 'teacher').eq('is_active', true),
  ])

  if (error) console.error('[center/courses]', error)

  const rows: CenterCourseRow[] = ((courses ?? []) as unknown as RawCourse[]).map(c => ({
    id: c.id,
    title: c.title,
    description: c.description,
    is_published: c.is_published,
    teacher_id: c.teacher_id,
    teacher_name: activeTeacherName(c.teacher),
    units: c.course_units?.[0]?.count ?? 0,
    enrollments: c.course_enrollments?.[0]?.count ?? 0,
  }))

  return (
    <CenterCoursesClient
      initialCourses={rows}
      hasTeachers={(activeTeachers ?? 0) > 0}
    />
  )
}
