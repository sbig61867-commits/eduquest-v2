export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { LessonView } from '@/components/lesson/lesson-view'
import { AskAiMenu } from '@/components/student/ask-ai-menu'
import { AskAiSelection } from '@/components/student/ask-ai-selection'
import { activeExamSince } from '@/lib/ask-ai'
import { audienceApproved } from '@/lib/ai/privacy'
import { studentExamListSql, toStudentExams } from '@/lib/data/student-exams'
import { LessonHomeworkTabs, type LessonHomeworkItem } from '@/components/student/lesson-homework-tabs'

// One lesson, full width, nothing else on screen. Read as the student: RLS
// (published lessons of their own groups) decides, and an archived group's
// lesson stays hidden exactly as on the list.
export default async function StudentLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound()
  const t = await getTranslations('common.lessonView')
  const user = await currentUser()
  if (!user) redirect('/login')

  // ONE unit: the lesson; whether the student is in the middle of an exam (the
  // "Ask an AI" menu is never offered while an attempt is running); the
  // student's own exam list (metadata only) for this lesson's homework; and
  // their submissions and redo permissions for that homework.
  const since = activeExamSince()
  const [lessonRows, runningRows, listedRows, subs, retakes] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select l.id, l.title, l.content, json_build_object('name', g.name) as groups
          from public.lessons l join public.groups g on g.id = l.group_id where l.id = ${id} and g.is_active`,
    sql`select count(*)::int as n from public.exam_submissions
         where student_id = ${user.id} and status = 'in_progress' and started_at >= ${since}`,
    studentExamListSql(sql),
    sql`select s.exam_id, s.score, s.max_score, s.grading_status from public.exam_submissions s
          join public.get_student_exam_list() e on e.id = s.exam_id
         where s.student_id = ${user.id} and e.type = 'homework' and e.lesson_id = ${id}`,
    sql`select r.exam_id from public.exam_retake_permissions r
          join public.get_student_exam_list() e on e.id = r.exam_id
         where r.student_id = ${user.id} and e.type = 'homework' and e.lesson_id = ${id}`,
  ])
  const lesson = maybeOne<{ id: string; title: string; content: string | null; groups: { name: string } | null }>(lessonRows)
  if (!lesson) notFound()
  const runningExams = maybeOne<{ n: number }>(runningRows)?.n ?? 0

  // This lesson's homework, as in the teacher's Homework tab (owner, 2026-10-18).
  const lessonHomework = toStudentExams(listedRows).filter(e => e.type === 'homework' && e.lesson_id === lesson.id)
  const subByExam = new Map((subs as Record<string, unknown>[]).map(r => [r.exam_id as string, r]))
  const redo = new Set((retakes as Record<string, unknown>[]).map(r => r.exam_id as string))
  const homework: LessonHomeworkItem[] = lessonHomework.map(e => {
    const sub = subByExam.get(e.id)
    return {
      id: e.id, title: e.title, instructions: e.instructions, question_count: e.question_count,
      duration_minutes: e.duration_minutes, ends_at: e.ends_at, assigned_to_me: !!e.assigned_student_id,
      has_manual_questions: e.has_manual_questions, can_redo: redo.has(e.id),
      submission: sub ? { score: sub.score as number | null, max_score: sub.max_score as number | null, grading_status: sub.grading_status as string } : null,
    }
  })
  const group = lesson.groups as unknown as { name: string } | null

  return (
    <>
      <header className="sticky top-0 z-20 bg-surface border-b border-line">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 h-14">
          <Link href="/student/lessons" className="eq-focus inline-flex items-center gap-1 rounded-control px-2 py-1 text-body-sm text-fg-2 hover:text-fg hover:bg-elevated shrink-0">
            <ChevronRight className="w-4 h-4 ltr:rotate-180" /> {t('back')}
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-h3 text-fg truncate">{lesson.title}</h1>
            {group?.name && <p className="text-label text-fg-3 truncate">{group.name}</p>}
          </div>
          {!runningExams && <AskAiMenu lessonTitle={lesson.title} groupName={group?.name} />}
        </div>
      </header>
      <main id="eq-lesson-body" className="max-w-6xl mx-auto px-4 py-6 lg:py-8" style={{ ['--eq-sticky-offset' as string]: '3.5rem' }}>
        <LessonHomeworkTabs homework={homework}>
          <LessonView content={lesson.content as string | null} title={lesson.title} lessonId={lesson.id} />
        </LessonHomeworkTabs>
      </main>
      {!runningExams && <AskAiSelection containerId="eq-lesson-body" lessonTitle={lesson.title} lessonId={lesson.id} platformEnabled={audienceApproved(['personal'])} />}
    </>
  )
}
