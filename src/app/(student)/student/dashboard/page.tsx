export const dynamic = 'force-dynamic'

import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { currentUser } from '@/lib/auth/current'
import { redirect } from 'next/navigation'
import { run, maybeOne } from '@/lib/db/sql'
import Link from 'next/link'
import { BookOpen, ClipboardList, BarChart2, Bell } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { SurveyCard } from '@/components/student/survey-card'
import { AnnouncementsBanner, type StudentAnnouncement } from '@/components/student/announcements-banner'
import { isScoreVisible } from '@/lib/score-visibility'
import { studentExamListSql, toStudentExams } from '@/lib/data/student-exams'

interface LessonRow { id: string; title: string; created_at: string; groups: { name: string } | null }
interface GradeRow { id: string; exam_id: string; score: number; max_score: number | null; grading_status: string | null }

export default async function StudentDashboard() {
  const t = await getTranslations('student.dashboard')
  const locale = (await getLocale()) as Locale
  const user = await currentUser()
  if (!user) redirect('/login')

  // ONE unit, read as the student. Same scoping as /student/lessons: published
  // lessons in the student's ACTIVE groups only (an archived group is hidden
  // from students; its membership stays).
  const [recentLessons, lessonCountRows, examList, submissionCount, grades, announcementRows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select l.id, l.title, l.created_at, case when g.id is null then null else json_build_object('name', g.name) end as groups
          from public.lessons l join public.groups g on g.id = l.group_id
         where l.is_published and g.is_active
           and l.group_id in (select group_id from public.group_students where student_id = ${user.id})
         order by l.created_at desc limit 5`,
    sql`select count(*)::int as n from public.lessons l join public.groups g on g.id = l.group_id
         where l.is_published and g.is_active
           and l.group_id in (select group_id from public.group_students where student_id = ${user.id})`,
    // Students have no direct exams SELECT; count enrolled exams via the list.
    studentExamListSql(sql),
    sql`select count(*)::int as n from public.exam_submissions where student_id = ${user.id}`,
    // exam_submissions, not grades: visibility depends on grading_status, and
    // the teacher's manual grade lives here. Over-fetch, then filter to 5.
    sql`select id, exam_id, score, max_score, grading_status from public.exam_submissions
         where student_id = ${user.id} and score is not null order by submitted_at desc limit 20`,
    // Students have no direct announcements SELECT; the function applies
    // publication state, the date window and audience targeting.
    sql`select * from public.get_student_announcements()`,
  ])
  const examRows = toStudentExams(examList)
  const lessonCount = maybeOne<{ n: number }>(lessonCountRows)?.n ?? 0
  const submissions = maybeOne<{ n: number }>(submissionCount)?.n ?? 0
  const exams = examRows.length
  const announcements = announcementRows as unknown as StudentAnnouncement[]

  const cards = [
    { label: t('statLessons'), value: lessonCount ?? 0, icon: BookOpen, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: t('statUpcoming'), value: exams ?? 0, icon: ClipboardList, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: t('statTaken'), value: submissions ?? 0, icon: BarChart2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: t('statNotifications'), value: '0', icon: Bell, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ]

  const lessonList = recentLessons as unknown as LessonRow[]
  // Students have no exams SELECT, so titles/types come from the exam list.
  const examById = new Map(examRows.map(e => [e.id, e]))
  const gradeList = (grades as unknown as GradeRow[])
    .filter(g => isScoreVisible(g.grading_status, examById.get(g.exam_id)?.type, examById.get(g.exam_id)?.has_manual_questions))
    .slice(0, 5)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>

      <AnnouncementsBanner announcements={announcements} track />

      <SurveyCard />

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
          <h3 className="text-white font-semibold mb-4">{t('latestLessons')}</h3>
          {lessonList.length === 0 ? (
            <p className="text-slate-500 text-sm">{t('noLessons')}</p>
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
                      <p className="text-slate-500 text-xs">{l.groups?.name ?? '—'} · {formatDate(l.created_at, locale)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">{t('myGrades')}</h3>
          {gradeList.length === 0 ? (
            <p className="text-slate-500 text-sm">{t('noGrades')}</p>
          ) : (
            <ul className="space-y-3">
              {gradeList.map(g => (
                <li key={g.id} className="flex items-center justify-between gap-3">
                  <p className="text-white text-sm font-medium truncate">{examById.get(g.exam_id)?.title ?? 'Exam'}</p>
                  <span className="text-emerald-400 text-sm font-semibold shrink-0">{g.score}{g.max_score != null ? `/${g.max_score}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
