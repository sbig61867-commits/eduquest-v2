export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Bell, BookOpen, ClipboardList, BarChart2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
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

  type RpcExamRow = { id: string; title: string; created_at: string; group_name: string | null; [key: string]: unknown }
  type LessonRow  = { id: string; title: string; created_at: string; groups: { name: string }[] | { name: string } | null }
  type GradeRow   = { id: string; score: number; submitted_at: string; exams: { title: string }[] | { title: string } | null }

  // RPC returns flat group_name; reshape to match the lessons/grades shape and cap at 10.
  const recentExams = (rpcExams ?? [])
    .slice(0, 10)
    .map((e: RpcExamRow) => ({ ...e, groups: e.group_name ? { name: e.group_name } : null }))

  // Merge and sort all notifications by date
  const notifications = [
    ...(recentLessons ?? [] as LessonRow[]).map((l: LessonRow) => ({
      id: `lesson-${l.id}`,
      type: 'lesson' as const,
      title: `New lesson: ${l.title}`,
      subtitle: `In group: ${Array.isArray(l.groups) ? (l.groups[0]?.name ?? '·') : (l.groups?.name ?? '·')}`,
      date: l.created_at,
    })),
    ...(recentExams ?? []).map((e: RpcExamRow & { groups: { name: string } | null }) => ({
      id: `exam-${e.id}`,
      type: 'exam' as const,
      title: `New exam: ${e.title}`,
      subtitle: `In group: ${e.groups?.name ?? '·'}`,
      date: e.created_at,
    })),
    ...(recentGrades ?? [] as GradeRow[]).map((g: GradeRow) => ({
      id: `grade-${g.id}`,
      type: 'grade' as const,
      title: `Grade posted: ${Array.isArray(g.exams) ? (g.exams[0]?.title ?? 'Exam') : (g.exams?.title ?? 'Exam')}`,
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
    lesson: 'bg-accent-subtle text-accent',
    exam: 'bg-accent-subtle text-accent',
    grade: 'bg-accent-subtle text-accent',
  }

  return (
    <>
      <PageTitle title="Notifications" />

      <div className="max-w-2xl mx-auto">
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-fg">Notifications</h1>
          <p className="text-[13px] text-fg-muted mt-1.5">Recent activity in your groups</p>
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center mb-4">
              <Bell className="w-5 h-5 text-fg-muted" aria-hidden="true" />
            </div>
            <p className="text-[15px] font-medium text-fg">No notifications yet</p>
            <p className="text-[13px] text-fg-muted mt-1.5 max-w-xs leading-relaxed">
              {groupIds.length === 0
                ? 'You are not enrolled in any group yet.'
                : 'New lessons and exams will appear here.'}
            </p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden divide-y divide-border">
            {notifications.map(n => {
              const Icon = iconMap[n.type as keyof typeof iconMap]
              const color = colorMap[n.type as keyof typeof colorMap]
              return (
                <div key={n.id} className="flex items-center gap-4 px-5 py-4 hover:bg-canvas transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                    <Icon className="w-[15px] h-[15px]" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-fg truncate">{n.title}</p>
                    <p className="text-[11px] text-fg-muted mt-0.5 truncate">{n.subtitle}</p>
                  </div>
                  <span className="text-[11px] text-fg-muted shrink-0">{formatDate(n.date)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
