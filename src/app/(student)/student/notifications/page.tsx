export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Bell, BookOpen, ClipboardList, BarChart2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Gather recent activity as notifications: new lessons & exams in student's groups
  const { data: memberOf } = await supabase
    .from('group_students')
    .select('group_id')
    .eq('student_id', user.id)

  const groupIds = (memberOf ?? []).map(r => r.group_id)

  // Exams come from the SECURITY DEFINER RPC (students have no direct exams
  // SELECT). It already returns only enrolled, published exams, answers stripped.
  const [{ data: recentLessons }, { data: rpcExams }, { data: recentGrades }] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from('lessons')
          .select('id, title, created_at, group_id, groups(name)')
          .in('group_id', groupIds)
          .eq('is_published', true)
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    supabase.rpc('get_student_exams'),
    supabase
      .from('exam_submissions')
      .select('id, score, submitted_at, exams(title)')
      .eq('student_id', user.id)
      .not('score', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(5),
  ])

  // RPC returns flat group_name; reshape to match the lessons/grades shape and cap at 10.
  const recentExams = (rpcExams ?? [])
    .slice(0, 10)
    .map((e: any) => ({ ...e, groups: e.group_name ? { name: e.group_name } : null }))

  // Merge and sort all notifications by date
  const notifications = [
    ...(recentLessons ?? []).map((l: any) => ({
      id: `lesson-${l.id}`,
      type: 'lesson' as const,
      title: `New lesson: ${l.title}`,
      subtitle: `In group: ${l.groups?.name ?? '—'}`,
      date: l.created_at,
    })),
    ...(recentExams ?? []).map((e: any) => ({
      id: `exam-${e.id}`,
      type: 'exam' as const,
      title: `New exam: ${e.title}`,
      subtitle: `In group: ${e.groups?.name ?? '—'}`,
      date: e.created_at,
    })),
    ...(recentGrades ?? []).map((g: any) => ({
      id: `grade-${g.id}`,
      type: 'grade' as const,
      title: `Grade posted: ${g.exams?.title ?? 'Exam'}`,
      subtitle: `Score: ${g.score} points`,
      date: g.submitted_at,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const iconMap = {
    lesson: BookOpen,
    exam: ClipboardList,
    grade: BarChart2,
  }

  const colorMap = {
    lesson: 'bg-violet-600/20 text-violet-400',
    exam: 'bg-amber-600/20 text-amber-400',
    grade: 'bg-emerald-600/20 text-emerald-400',
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Notifications</h2>
        <p className="text-slate-400 mt-1">Recent activity in your groups</p>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Bell className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-white font-medium">No notifications yet</p>
          <p className="text-slate-400 text-sm mt-1">
            {groupIds.length === 0
              ? 'You are not enrolled in any group yet.'
              : 'New lessons and exams will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => {
            const Icon = iconMap[n.type as keyof typeof iconMap]
            const color = colorMap[n.type as keyof typeof colorMap]
            return (
              <div key={n.id} className="flex items-start gap-4 bg-slate-900 border border-slate-800 rounded-xl px-5 py-4 hover:border-slate-700 transition-colors">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{n.title}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{n.subtitle}</p>
                </div>
                <span className="text-slate-500 text-xs shrink-0">{formatDate(n.date)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
