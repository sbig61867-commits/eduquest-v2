export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GraduationCap, Users, BookOpen, ClipboardList } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDate } from '@/lib/utils'

// Lesson/exam figures come from the metadata-only admin feeds (the admin
// has no direct RLS read on lessons/exams — that would expose content and
// questions). Teacher/student counts stay on `users`, which the admin can read.
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

  // tenant_id comes from the JWT claims (synced by sync_user_claims) — no DB lookup needed
  const tenantId = user.tenant_id
  if (!tenantId) redirect('/login?error=no_tenant')

  // Metadata-only admin feeds (no content / no questions). Recent lessons
  // stand in as the activity feed until a dedicated audit table exists.
  const [{ data: lessonRows }, { data: examRows }] = await Promise.all([
    supabase.rpc('get_admin_lessons'),
    supabase.rpc('get_admin_exams'),
  ])
  const allLessons = (lessonRows ?? []) as unknown as AdminLessonMeta[]
  const stats = await getStats(supabase, tenantId, allLessons.length, (examRows ?? []).length)
  const activity = allLessons.slice(0, 5)

  const cards = [
    { label: 'Teachers', value: stats.teachers, icon: GraduationCap, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Students', value: stats.students, icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Lessons', value: stats.lessons, icon: BookOpen, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: 'Exams', value: stats.exams, icon: ClipboardList, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">University Dashboard</h2>
        <p className="text-slate-400 mt-1">Overview of your institution</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-slate-400 text-sm">{card.label}</p>
                <div className={`p-2 rounded-lg ${card.bg}`}>
                  <Icon className={`w-5 h-5 ${card.color}`} />
                </div>
              </div>
              <p className="text-3xl font-bold text-white">{card.value}</p>
            </div>
          )
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4">Recent Activity</h3>
        {activity.length === 0 ? (
          <p className="text-slate-500 text-sm">No activity yet.</p>
        ) : (
          <ul className="space-y-3">
            {activity.map(a => (
              <li key={a.id} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0">
                  <BookOpen className="w-4 h-4 text-violet-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate">
                    {a.teacher_name ?? 'Teacher'} {a.is_published ? 'published' : 'created'} lesson “{a.title}”
                  </p>
                  <p className="text-slate-500 text-xs">{formatDate(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
