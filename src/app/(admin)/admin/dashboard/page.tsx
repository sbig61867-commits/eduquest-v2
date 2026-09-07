export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GraduationCap, Users, BookOpen, ClipboardList } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDate } from '@/lib/utils'

interface AdminLessonMeta { id: string; title: string; created_at: string; is_published: boolean; teacher_name: string | null }

async function getStats(supabase: SupabaseClient, tenantId: string, lessons: number, exams: number) {
  const [{ count: teachers }, { count: students }] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'teacher'),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'student'),
  ])
  return { teachers: teachers ?? 0, students: students ?? 0, lessons, exams }
}

export default async function AdminDashboard() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const tenantId = user.tenant_id
  if (!tenantId) redirect('/login?error=no_tenant')

  const [{ data: lessonRows }, { data: examRows }] = await Promise.all([
    supabase.rpc('get_admin_lessons'),
    supabase.rpc('get_admin_exams'),
  ])
  const allLessons = (lessonRows ?? []) as unknown as AdminLessonMeta[]
  const stats = await getStats(supabase, tenantId, allLessons.length, (examRows ?? []).length)
  const activity = allLessons.slice(0, 8)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-fg">Dashboard</h1>

      {/* Institution health strip — real signals only */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Teachers', value: stats.teachers, icon: GraduationCap, href: '/admin/teachers' },
          { label: 'Students', value: stats.students, icon: Users, href: '/admin/students' },
          { label: 'Lessons', value: stats.lessons, icon: BookOpen, href: '/admin/lessons' },
          { label: 'Exams', value: stats.exams, icon: ClipboardList, href: '/admin/exams' },
        ].map(({ label, value, href, icon: Icon }) => (
          <a key={label} href={href}
            className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-3 hover:border-border-strong transition-colors">
            <Icon className="w-4 h-4 text-accent shrink-0" />
            <div>
              <p className="text-lg font-semibold text-fg leading-none">{value}</p>
              <p className="text-xs text-fg-muted mt-0.5">{label}</p>
            </div>
          </a>
        ))}
      </div>

      {/* Lesson activity — honestly labeled, not "Recent Activity" implying a full audit log */}
      <div className="bg-surface border border-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-fg">Recent Lesson Activity</h2>
        </div>
        <p className="text-xs text-fg-muted mb-4">Latest lessons created or updated by your teachers</p>
        {activity.length === 0 ? (
          <p className="text-fg-muted text-sm">No lessons yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map(a => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <div className="w-7 h-7 rounded-md bg-accent-subtle flex items-center justify-center shrink-0">
                  <BookOpen className="w-3.5 h-3.5 text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg truncate">
                    <span className="font-medium">{a.teacher_name ?? 'Teacher'}</span>
                    {' '}{a.is_published ? 'published' : 'created'}{' '}
                    <span className="text-fg-secondary">"{a.title}"</span>
                  </p>
                  <p className="text-xs text-fg-muted">{formatDate(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
