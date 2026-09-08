export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GraduationCap, Users, BookOpen, ClipboardList } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDate } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'

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
  const activity = allLessons.slice(0, 10)

  const statItems = [
    { label: 'Teachers', value: stats.teachers, icon: GraduationCap, href: '/admin/teachers' },
    { label: 'Students', value: stats.students, icon: Users, href: '/admin/students' },
    { label: 'Lessons',  value: stats.lessons,  icon: BookOpen,     href: '/admin/lessons' },
    { label: 'Exams',    value: stats.exams,    icon: ClipboardList, href: '/admin/exams' },
  ]

  return (
    <>
      <PageTitle title="Dashboard" />

      <div className="max-w-4xl mx-auto">
        {/* Health strip */}
        <div className="flex items-center gap-6 mb-8 pb-7 border-b border-border flex-wrap">
          {statItems.map(({ label, value, href, icon: Icon }, i) => (
            <>
              {i > 0 && <div key={`div-${label}`} className="w-px h-8 bg-border hidden sm:block" aria-hidden="true" />}
              <a key={label} href={href} className="group">
                <p className="text-2xl font-semibold text-fg group-hover:text-accent transition-colors leading-none">
                  {value}
                </p>
                <p className="flex items-center gap-1.5 text-[12px] text-fg-muted mt-1">
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {label}
                </p>
              </a>
            </>
          ))}
        </div>

        {/* Lesson activity feed */}
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-[13px] font-semibold text-fg">Lesson Activity</h2>
            <p className="text-[11px] text-fg-muted mt-0.5">Latest lessons created or updated by your teachers</p>
          </div>
          {activity.length === 0 ? (
            <div className="px-5 py-8">
              <p className="text-[13px] text-fg-muted">No lessons yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map(a => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="w-7 h-7 rounded-md bg-accent-subtle flex items-center justify-center shrink-0">
                    <BookOpen className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-fg truncate">
                      <span className="font-medium">{a.teacher_name ?? 'Teacher'}</span>
                      {' '}{a.is_published ? 'published' : 'created'}{' '}
                      <span className="text-fg-secondary">"{a.title}"</span>
                    </p>
                    <p className="text-[11px] text-fg-muted mt-0.5">{formatDate(a.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
