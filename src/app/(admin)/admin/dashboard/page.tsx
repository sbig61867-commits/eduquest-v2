export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GraduationCap, Users, BookOpen, ClipboardList } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDate } from '@/lib/utils'

async function getStats(supabase: SupabaseClient, tenantId: string) {
  const [{ count: teachers }, { count: students }, { count: lessons }, { count: exams }] =
    await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'teacher'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'student'),
      supabase.from('lessons').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('exams').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    ])
  return { teachers: teachers ?? 0, students: students ?? 0, lessons: lessons ?? 0, exams: exams ?? 0 }
}

export default async function AdminDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) redirect('/login?error=no_tenant')

  const stats = await getStats(supabase, profile.tenant_id)

  // Recent lessons stand in as the activity feed until a dedicated audit table exists
  const { data: recentLessons } = await supabase
    .from('lessons')
    .select('id, title, created_at, is_published, users:teacher_id(full_name)')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(5)
  const activity = (recentLessons ?? []) as unknown as Array<{ id: string; title: string; created_at: string; is_published: boolean; users: { full_name: string } | null }>

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
                    {a.users?.full_name ?? 'Teacher'} {a.is_published ? 'published' : 'created'} lesson “{a.title}”
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
