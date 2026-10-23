export const dynamic = 'force-dynamic'

import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { Bell, BookOpen, ClipboardList, BarChart2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { isScoreVisible } from '@/lib/score-visibility'
import { studentExamListSql, toStudentExams, type StudentExamMeta } from '@/lib/data/student-exams'

export default async function NotificationsPage() {
  const t = await getTranslations('student.notifications')
  const locale = (await getLocale()) as Locale
  const user = await currentUser()
  if (!user) redirect('/login')

  // ONE unit, read as the student: new lessons in the student's ACTIVE groups
  // (an archived group is hidden from students; its membership stays), the
  // exam list (students have no direct exams SELECT) and recent grades.
  const [recentLessons, examList, recentGrades, activeGroupRows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select l.id, l.title, l.created_at, l.group_id, case when g.id is null then null else json_build_object('name', g.name) end as groups
          from public.lessons l join public.groups g on g.id = l.group_id
         where l.is_published and g.is_active
           and l.group_id in (select group_id from public.group_students where student_id = ${user.id})
         order by l.created_at desc limit 10`,
    studentExamListSql(sql),
    sql`select id, exam_id, score, submitted_at, grading_status from public.exam_submissions
         where student_id = ${user.id} and score is not null order by submitted_at desc limit 20`,
    sql`select count(*)::int as n from public.group_students gs join public.groups g on g.id = gs.group_id
         where gs.student_id = ${user.id} and g.is_active`,
  ])
  const hasGroups = ((activeGroupRows[0] as { n?: number } | undefined)?.n ?? 0) > 0
  const rpcExams = toStudentExams(examList)

  type RpcExamRow = StudentExamMeta
  type LessonRow  = { id: string; title: string; created_at: string; groups: { name: string }[] | { name: string } | null }
  type GradeRow   = { id: string; exam_id: string; score: number; submitted_at: string; grading_status: string | null }

  // RPC returns flat group_name; reshape to match the lessons/grades shape and cap at 10.
  const recentExams = rpcExams
    .slice(0, 10)
    .map((e: RpcExamRow) => ({ ...e, groups: e.group_name ? { name: e.group_name } : null }))

  // Students have no exams SELECT (a joined exams(title) is null), so titles
  // and types come from the RPC. Unpublished homework scores are not "posted".
  const examById = new Map(rpcExams.map(e => [e.id, e]))
  const visibleGrades = (recentGrades as unknown as GradeRow[])
    .filter(g => isScoreVisible(g.grading_status, examById.get(g.exam_id)?.type, examById.get(g.exam_id)?.has_manual_questions))
    .slice(0, 5)

  // Merge and sort all notifications by date
  const notifications = [
    ...(recentLessons as unknown as LessonRow[]).map((l: LessonRow) => ({
      id: `lesson-${l.id}`,
      type: 'lesson' as const,
      title: `New lesson: ${l.title}`,
      subtitle: `In group: ${Array.isArray(l.groups) ? (l.groups[0]?.name ?? '—') : (l.groups?.name ?? '—')}`,
      date: l.created_at,
    })),
    ...(recentExams ?? []).map((e: RpcExamRow & { groups: { name: string } | null }) => ({
      id: `exam-${e.id}`,
      type: 'exam' as const,
      title: `New exam: ${e.title}`,
      subtitle: `In group: ${e.groups?.name ?? '—'}`,
      date: e.created_at,
    })),
    ...visibleGrades.map((g: GradeRow) => ({
      id: `grade-${g.id}`,
      type: 'grade' as const,
      title: `Grade posted: ${examById.get(g.exam_id)?.title ?? 'Exam'}`,
      subtitle: t('scorePoints', { score: g.score ?? 0 }),
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
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Bell className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-white font-medium">{t('empty')}</p>
          <p className="text-slate-400 text-sm mt-1">
            {!hasGroups
              ? t('noGroups')
              : t('noGroupsHint')}
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
                <span className="text-slate-500 text-xs shrink-0">{formatDate(n.date, locale)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
