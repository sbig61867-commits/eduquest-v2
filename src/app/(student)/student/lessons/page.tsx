export const dynamic = 'force-dynamic'

import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, ClipboardList, CheckCircle2, CalendarClock } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { LessonTabs } from '@/components/shared/lesson-tabs'

export default async function StudentLessonsPage() {
  const t = await getTranslations('student.lessons')
  const locale = (await getLocale()) as Locale
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Get only the groups this student is enrolled in
  const { data: groupRows } = await supabase
    .from('group_students')
    .select('group_id')
    .eq('student_id', user.id)

  const groupIds = (groupRows ?? []).map(r => r.group_id)

  // groups!inner + is_active filter: lessons of archived groups are hidden.
  const lessons = groupIds.length === 0 ? [] : await supabase
    .from('lessons')
    .select('*, groups!inner(name, is_active)')
    .eq('is_published', true)
    .eq('groups.is_active', true)
    .in('group_id', groupIds)
    .order('created_at', { ascending: false })
    .then(r => r.data ?? [])

  // Homework created inside a lesson lives in the `exams` table with
  // type='homework' and lesson_id set (homework_exam_migration.sql).
  // Students have no direct SELECT on `exams`, so it comes through the
  // same answer-stripped, enrolment-scoped feed the exams page uses.
  // Before student_exams_expose_type_migration.sql the feed carries
  // neither column, in which case this section stays empty and the exams
  // page remains the only place homework shows up — no crash either way.
  type HomeworkRow = { id: string; title: string; ends_at: string | null; type?: string; lesson_id?: string | null }
  const [{ data: feed }, { data: hwSubmissions }] = await Promise.all([
    supabase.rpc('get_student_exams'),
    supabase.from('exam_submissions').select('exam_id').eq('student_id', user.id),
  ])
  const submittedIds = new Set((hwSubmissions ?? []).map(r => r.exam_id))
  const homeworkByLesson = new Map<string, HomeworkRow[]>()
  for (const row of (feed ?? []) as HomeworkRow[]) {
    if (row.type !== 'homework' || !row.lesson_id) continue
    const bucket = homeworkByLesson.get(row.lesson_id)
    if (bucket) bucket.push(row)
    else homeworkByLesson.set(row.lesson_id, [row])
  }

  // A student enrolled in several subjects must see each one in its own
  // section — a single merged list blurs two different courses together.
  type StudentLesson = { id: string; title: string; created_at: string; content: string; groups: { name: string } | null }
  const bySubject = new Map<string, StudentLesson[]>()
  for (const lesson of lessons as StudentLesson[]) {
    const subject = lesson.groups?.name ?? t('otherSubject')
    const bucket = bySubject.get(subject)
    if (bucket) bucket.push(lesson)
    else bySubject.set(subject, [lesson])
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">
          {/* ICU plural: Arabic picks between six grammatical forms (English
              two) from one key, so singular/dual/few/many all come out
              correct without this call site knowing the rules. The old
              "label: count" phrasing here was a workaround for not having
              them. */}
          {t('count', { count: lessons.length })}
          {bySubject.size > 1 && ` · ${t('subjectCount', { count: bySubject.size })}`}
        </p>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('emptyTitle')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('emptyHint')}</p>
        </div>
      ) : (
        [...bySubject.entries()].map(([subject, subjectLessons]) => (
        <section key={subject} className="border border-slate-800 rounded-2xl overflow-hidden">
          <header className="flex items-center gap-2.5 px-5 py-3.5 bg-slate-900/80 border-b border-slate-800">
            <BookOpen className="w-4 h-4 text-blue-400 shrink-0" />
            <h3 className="text-white font-semibold truncate">{subject}</h3>
            <span className="text-slate-500 text-xs me-auto shrink-0">{t('lessonCount', { count: subjectLessons.length })}</span>
          </header>
          <div className="p-5 space-y-3">
          {subjectLessons.map((lesson) => (
            <details key={lesson.id} className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-colors">
              <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">{lesson.title}</h3>
                    {/* subject name lives in the section header now */}
                    <p className="text-slate-400 text-sm">{formatDate(lesson.created_at, locale)}</p>
                  </div>
                </div>
                <span className="text-slate-500 text-sm group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-5 pb-5 border-t border-slate-800 pt-4 space-y-4">
                <LessonTabs content={lesson.content ?? ''} />
                {(homeworkByLesson.get(lesson.id) ?? []).length > 0 && (
                  <div className="space-y-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-400">
                      <ClipboardList className="w-4 h-4 shrink-0" /> {t('homeworkTitle')}
                    </h4>
                    {(homeworkByLesson.get(lesson.id) ?? []).map(hw => {
                      const done = submittedIds.has(hw.id)
                      return (
                        <div key={hw.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-900 border border-slate-800 p-3">
                          <span className="text-white text-sm font-medium flex-1 min-w-0 truncate">{hw.title}</span>
                          {hw.ends_at && (
                            <span className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
                              <CalendarClock className="w-3.5 h-3.5" /> {t('homeworkDue', { date: formatDate(hw.ends_at, locale) })}
                            </span>
                          )}
                          {done ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 shrink-0">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {t('homeworkSubmitted')}
                            </span>
                          ) : (
                            <Link
                              href={`/student/exams?open=${hw.id}`}
                              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
                            >
                              {t('homeworkSolve')}
                            </Link>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </details>
          ))}
          </div>
        </section>
        ))
      )}
    </div>
  )
}
