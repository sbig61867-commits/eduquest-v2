export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { CoursesClient } from './courses-client'
import { Lock, GraduationCap } from 'lucide-react'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function CoursesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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
        <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-5">
          <Lock className="w-8 h-8 text-slate-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Courses — Permission Required</h2>
        <p className="text-slate-400 max-w-sm">
          You need your university admin to enable course creation for your account before you can access this section.
        </p>
        <div className="mt-6 flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 border border-slate-800">
          <GraduationCap className="w-4 h-4 text-slate-500" />
          <span className="text-slate-500 text-sm">Ask your university admin to grant you course creation access</span>
        </div>
      </div>
    )
  }

  const { data: courses } = await adminClient()
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
