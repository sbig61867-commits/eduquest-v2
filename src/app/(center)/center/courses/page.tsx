export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/center/no-permission'
import { CenterCoursesClient, type CenterCourseRow } from '@/components/center/courses-client'

interface RawCourse {
  id: string
  title: string
  description: string | null
  is_published: boolean
  teacher_id: string
  course_units: { count: number }[] | null
  course_enrollments: { count: number }[] | null
}

export default async function CenterCoursesPage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_courses')) return <NoPermission label="إدارة الكورسات" />

  const [{ data: courses, error }, { data: teachers }, { data: students }] = await Promise.all([
    supabase.from('courses')
      .select('id, title, description, is_published, teacher_id, course_units(count), course_enrollments(count)')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('users').select('id, full_name')
      .eq('tenant_id', tenantId).eq('role', 'teacher').eq('is_active', true).order('full_name'),
    supabase.from('users').select('id, full_name')
      .eq('tenant_id', tenantId).eq('role', 'student').eq('is_active', true).order('full_name'),
  ])

  if (error) console.error('[center/courses]', error)

  const rows: CenterCourseRow[] = ((courses ?? []) as unknown as RawCourse[]).map(c => ({
    id: c.id,
    title: c.title,
    description: c.description,
    is_published: c.is_published,
    teacher_id: c.teacher_id,
    units: c.course_units?.[0]?.count ?? 0,
    enrollments: c.course_enrollments?.[0]?.count ?? 0,
  }))

  return (
    <CenterCoursesClient
      initialCourses={rows}
      teachers={(teachers ?? []).map(t => ({ id: t.id as string, name: (t.full_name as string) || '—' }))}
      students={(students ?? []).map(s => ({ id: s.id as string, name: (s.full_name as string) || '—' }))}
    />
  )
}
