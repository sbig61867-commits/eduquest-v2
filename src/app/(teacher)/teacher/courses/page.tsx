export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CoursesClient } from './courses-client'

export default async function CoursesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('can_create_courses, tenant_id')
    .eq('id', user.id)
    .single()

  // Only teachers with permission or admins can access this page
  if (!profile?.can_create_courses) {
    redirect('/teacher/dashboard')
  }

  const { data: courses } = await supabase
    .from('courses')
    .select(`
      *,
      course_levels(count),
      course_enrollments(count)
    `)
    .eq('teacher_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <CoursesClient
      initialCourses={courses ?? []}
      teacherId={user.id}
      tenantId={profile.tenant_id ?? ''}
    />
  )
}
