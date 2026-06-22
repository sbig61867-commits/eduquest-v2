export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { BookOpen, ClipboardList, BarChart2, Bell } from 'lucide-react'

export default async function StudentDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ count: lessons }, { count: exams }, { count: submissions }] = await Promise.all([
    supabase.from('lessons').select('*', { count: 'exact', head: true }),
    supabase.from('exams').select('*', { count: 'exact', head: true }).eq('is_published', true),
    supabase.from('exam_submissions').select('*', { count: 'exact', head: true }).eq('student_id', user?.id ?? ''),
  ])

  const cards = [
    { label: 'Available Lessons', value: lessons ?? 0, icon: BookOpen, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Upcoming Exams', value: exams ?? 0, icon: ClipboardList, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: 'Exams Taken', value: submissions ?? 0, icon: BarChart2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Notifications', value: '0', icon: Bell, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">My Dashboard</h2>
        <p className="text-slate-400 mt-1">Track your progress and upcoming activities</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Recent Lessons</h3>
          <p className="text-slate-500 text-sm">No lessons assigned yet.</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">My Grades</h3>
          <p className="text-slate-500 text-sm">No grades yet.</p>
        </div>
      </div>
    </div>
  )
}
