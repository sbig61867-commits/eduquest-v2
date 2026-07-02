export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { BookOpen, ClipboardList, BarChart2, Bell } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface LessonRow { id: string; title: string; created_at: string; groups: { name: string } | null }
interface GradeRow { id: string; score: number; max_score: number; exams: { title: string } | null }

export default async function StudentDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Same scoping as /student/lessons: published lessons in the student's groups only
  const { data: groupRows } = await supabase
    .from('group_students')
    .select('group_id')
    .eq('student_id', user?.id ?? '')
  const groupIds = (groupRows ?? []).map(r => r.group_id)

  const [{ data: recentLessons, count: lessonCount }, { data: examRows }, { count: submissions }, { data: grades }] = await Promise.all([
    groupIds.length === 0
      ? Promise.resolve({ data: [], count: 0 } as { data: LessonRow[]; count: number })
      : supabase
          .from('lessons')
          .select('id, title, created_at, groups(name)', { count: 'exact' })
          .eq('is_published', true)
          .in('group_id', groupIds)
          .order('created_at', { ascending: false })
          .limit(5),
    // Students have no direct exams SELECT; count enrolled exams via the RPC.
    supabase.rpc('get_student_exams'),
    supabase.from('exam_submissions').select('*', { count: 'exact', head: true }).eq('student_id', user?.id ?? ''),
    supabase.from('grades').select('id, score, max_score, exams(title)').eq('student_id', user?.id ?? '').order('graded_at', { ascending: false }).limit(5),
  ])
  const exams = (examRows ?? []).length

  const cards = [
    { label: 'Available Lessons', value: lessonCount ?? 0, icon: BookOpen, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Upcoming Exams', value: exams ?? 0, icon: ClipboardList, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: 'Exams Taken', value: submissions ?? 0, icon: BarChart2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Notifications', value: '0', icon: Bell, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ]

  const lessonList = (recentLessons ?? []) as unknown as LessonRow[]
  const gradeList = (grades ?? []) as unknown as GradeRow[]

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
          {lessonList.length === 0 ? (
            <p className="text-slate-500 text-sm">No lessons assigned yet.</p>
          ) : (
            <ul className="space-y-3">
              {lessonList.map(l => (
                <li key={l.id}>
                  <Link href="/student/lessons" className="flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                      <BookOpen className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium truncate group-hover:text-blue-400 transition-colors">{l.title}</p>
                      <p className="text-slate-500 text-xs">{l.groups?.name ?? '—'} · {formatDate(l.created_at)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">My Grades</h3>
          {gradeList.length === 0 ? (
            <p className="text-slate-500 text-sm">No grades yet.</p>
          ) : (
            <ul className="space-y-3">
              {gradeList.map(g => (
                <li key={g.id} className="flex items-center justify-between gap-3">
                  <p className="text-white text-sm font-medium truncate">{g.exams?.title ?? 'Exam'}</p>
                  <span className="text-emerald-400 text-sm font-semibold shrink-0">{g.score}/{g.max_score}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
