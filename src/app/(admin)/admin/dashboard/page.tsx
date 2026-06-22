export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GraduationCap, Users, BookOpen, ClipboardList } from 'lucide-react'

async function getStats(tenantId: string) {
  const supabase = await createClient()
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

  // Resolve the admin's real tenant — counts are scoped to their university
  const { data: profile } = await supabase
    .from('users').select('tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) redirect('/login?error=no_tenant')

  const stats = await getStats(profile.tenant_id)

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
        <p className="text-slate-500 text-sm">No activity yet.</p>
      </div>
    </div>
  )
}
