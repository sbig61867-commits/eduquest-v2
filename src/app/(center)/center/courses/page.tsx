export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { run } from '@/lib/db/sql'
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
  const { userId, tenantId, has } = await loadCenterAccess()
  if (!has('manage_courses')) return <NoPermission capability="manage_courses" />

  // Teachers are found on demand (/api/teachers/search, ≤ 20 per search); the page
  // only needs each course's teacher name and whether any active teacher exists.
  // Students to enrol are found on demand in RosterModal (/api/roster/candidates, ≤ 20).
  const [courses, teacherCount] = await run({ as: 'user', userId }, sql => [
    sql`select c.id, c.title, c.description, c.is_published, c.teacher_id,
               json_build_array(json_build_object('count', (select count(*)::int from public.course_units x where x.course_id = c.id))) as course_units,
               json_build_array(json_build_object('count', (select count(*)::int from public.course_enrollments x where x.course_id = c.id))) as course_enrollments,
               case when u.id is null then null else json_build_object('full_name', u.full_name, 'role', u.role, 'is_active', u.is_active) end as teacher
          from public.courses c left join public.users u on u.id = c.teacher_id
         where c.tenant_id = ${tenantId} and c.deleted_at is null
         order by c.created_at desc limit 1000`,
    sql`select count(*)::int as n from public.users where tenant_id = ${tenantId} and role = 'teacher' and is_active`,
  ])
  const activeTeachers = (teacherCount[0] as { n: number } | undefined)?.n ?? 0

  const rows: CenterCourseRow[] = (courses as unknown as RawCourse[]).map(c => ({
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
