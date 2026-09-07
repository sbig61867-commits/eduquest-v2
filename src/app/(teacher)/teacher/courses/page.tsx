export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CoursesClient } from './courses-client'
import { Lock, GraduationCap } from 'lucide-react'

export default async function CoursesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('can_create_courses, tenant_id')
    .eq('id', user.id)
    .single()

  // Show a friendly "permission required" page instead of silent redirect
  if (!profile?.can_create_courses) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-16 h-16 rounded-lg bg-surface flex items-center justify-center mb-5">
          <Lock className="w-8 h-8 text-fg-muted" />
        </div>
        <h2 className="text-xl font-bold text-fg mb-2">Courses — Permission Required</h2>
        <p className="text-fg-secondary max-w-sm">
          You need your university admin to enable course creation for your account before you can access this section.
        </p>
        <div className="mt-6 flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border">
          <GraduationCap className="w-4 h-4 text-fg-muted" />
          <span className="text-fg-muted text-sm">Ask your university admin to grant you course creation access</span>
        </div>
      </div>
    )
  }

  const { data: courses } = await supabase
    .from('courses')
    .select('*, course_levels(count), course_enrollments(count)')
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
