export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { ArrowRight, BookOpen, ClipboardList } from 'lucide-react'
import { formatDate, settle } from '@/lib/utils'
import { SurveyCard } from '@/components/student/survey-card'
import { AnnouncementsBanner, type StudentAnnouncement } from '@/components/student/announcements-banner'
import { PageTitle } from '@/components/shared/page-title'
import { Badge } from '@/components/ui/badge'
import { StaggerGrid, StaggerItem, ProgressBar } from '@/components/shared/motion'

interface LessonRow { id: string; title: string; created_at: string; groups: { name: string } | null }
interface GradeRow { id: string; score: number; max_score: number; submitted_at: string; exams: { title: string } | null }

function timeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default async function StudentDashboard() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)

  const { data: profile } = await supabase
    .from('users').select('full_name').eq('id', user?.id ?? '').single()

  const { data: groupRows } = await supabase
    .from('group_students').select('group_id').eq('student_id', user?.id ?? '')
  const groupIds = (groupRows ?? []).map(r => r.group_id)

  const [
    { data: recentLessons, count: lessonCount },
    { data: examRows },
    { count: submissions },
    { data: grades },
    { data: announcementRows },
  ] = await Promise.all([
    groupIds.length === 0
      ? Promise.resolve({ data: [], count: 0 } as { data: LessonRow[]; count: number })
      : settle(supabase
          .from('lessons')
          .select('id, title, created_at, groups(name)', { count: 'exact' })
          .eq('is_published', true)
          .in('group_id', groupIds)
          .order('created_at', { ascending: false })
          .limit(5), 'student/recentLessons'),
    settle(supabase.rpc('get_student_exams'), 'student/exams'),
    settle(supabase.from('exam_submissions').select('id', { count: 'exact', head: true }).eq('student_id', user?.id ?? ''), 'student/submissionCount'),
    settle(supabase
      .from('exam_submissions')
      .select('id, score, max_score, submitted_at, exams(title)')
      .eq('student_id', user?.id ?? '')
      .not('score', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(5), 'student/recentGrades'),
    settle(supabase.rpc('get_student_announcements'), 'student/announcements'),
  ])

  const exams = (examRows ?? []).length
  const announcements = (announcementRows ?? []) as unknown as StudentAnnouncement[]
  const lessonList = (recentLessons ?? []) as unknown as LessonRow[]
  const gradeList = (grades ?? []) as unknown as GradeRow[]
  const resumeLesson = lessonList[0] ?? null
  const firstName = profile?.full_name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'Student'

  return (
    <>
      <PageTitle title="Dashboard" />

      <div className="max-w-5xl mx-auto">
        {/* Greeting */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-fg">
            {timeOfDay()}, {firstName}
          </h1>
          <p className="text-[13px] text-fg-muted mt-1.5">
            {lessonCount ?? 0} {lessonCount === 1 ? 'lesson' : 'lessons'} available
            {exams > 0 && <> · {exams} {exams === 1 ? 'exam' : 'exams'} upcoming</>}
          </p>
        </div>

        <AnnouncementsBanner announcements={announcements} />
        <SurveyCard />

        {/* Continue Learning — the dominant focal element */}
        <div className="bg-surface border border-border rounded-lg mb-6">
          <div className="px-6 pt-5 pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
              Continue Learning
            </p>
          </div>

          {resumeLesson ? (
            <div className="px-6 py-5 flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold text-fg leading-snug">
                  {resumeLesson.title}
                </h2>
                <p className="text-[13px] text-fg-muted mt-1.5">
                  {resumeLesson.groups?.name ?? '·'}
                  <span className="mx-2 text-border-strong">·</span>
                  {formatDate(resumeLesson.created_at)}
                </p>
              </div>
              <Link
                href="/student/lessons"
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-accent-fg text-[13px] font-medium hover:bg-accent-hover transition-colors whitespace-nowrap"
              >
                Open <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="px-6 py-8 text-center">
              <BookOpen className="w-8 h-8 text-fg-muted mx-auto mb-3" aria-hidden="true" />
              <p className="text-[15px] text-fg">No lessons yet</p>
              <p className="text-[13px] text-fg-muted mt-1">
                Your teacher will publish lessons as the course progresses.
              </p>
            </div>
          )}

          {/* Lesson list — secondary, below the hero */}
          {lessonList.length > 1 && (
            <div className="border-t border-border divide-y divide-border">
              {lessonList.slice(1).map(l => (
                <Link
                  key={l.id}
                  href="/student/lessons"
                  className="flex items-center gap-3 px-6 py-3.5 hover:bg-canvas transition-colors group"
                >
                  <BookOpen className="w-4 h-4 text-fg-muted shrink-0" aria-hidden="true" />
                  <span className="text-[13px] text-fg-secondary group-hover:text-fg transition-colors truncate">
                    {l.title}
                  </span>
                  <span className="text-[11px] text-fg-muted ms-auto shrink-0">
                    {formatDate(l.created_at)}
                  </span>
                </Link>
              ))}
              <div className="px-6 py-3">
                <Link href="/student/lessons" className="text-[13px] text-accent hover:text-accent-hover transition-colors">
                  View all {lessonCount} lessons →
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Secondary — Grades + Quick stats */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Recent grades */}
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-[13px] font-semibold text-fg">Recent Grades</h2>
              <Link href="/student/grades" className="text-[12px] text-accent hover:text-accent-hover transition-colors">
                View all
              </Link>
            </div>
            {gradeList.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[13px] text-fg-muted">No grades yet.</p>
              </div>
            ) : (
              <StaggerGrid className="divide-y divide-border">
                {gradeList.map(g => {
                  const max = g.max_score || 1
                  const pct = Math.round(((g.score ?? 0) / max) * 100)
                  const passed = pct >= 60
                  return (
                    <StaggerItem key={g.id} className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-fg truncate">
                            {g.exams?.title ?? 'Exam'}
                          </p>
                          <p className="text-[11px] text-fg-muted mt-0.5">
                            {formatDate(g.submitted_at)}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <span className={`text-[13px] font-semibold ${passed ? 'text-accent' : 'text-error'}`}>
                            {g.score}/{max}
                          </span>
                          <Badge variant={passed ? 'success' : 'error'} className="text-[10px]">
                            {pct}%
                          </Badge>
                        </div>
                      </div>
                      <ProgressBar value={pct} accent={passed ? 'var(--color-accent)' : 'var(--color-error)'} showPercent={false} className="mt-2" />
                    </StaggerItem>
                  )
                })}
              </StaggerGrid>
            )}
          </div>

          {/* Quick stats + upcoming exams */}
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-[13px] font-semibold text-fg">Your Progress</h2>
            </div>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="flex items-center gap-2.5 text-[13px] text-fg-secondary">
                  <BookOpen className="w-4 h-4 text-fg-muted" aria-hidden="true" />
                  Lessons available
                </span>
                <span className="text-[13px] font-semibold text-fg">{lessonCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="flex items-center gap-2.5 text-[13px] text-fg-secondary">
                  <ClipboardList className="w-4 h-4 text-fg-muted" aria-hidden="true" />
                  Exams
                </span>
                <span className="text-[13px] font-semibold text-fg">{exams}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="flex items-center gap-2.5 text-[13px] text-fg-secondary">
                  <ClipboardList className="w-4 h-4 text-fg-muted" aria-hidden="true" />
                  Submissions taken
                </span>
                <span className="text-[13px] font-semibold text-fg">{submissions ?? 0}</span>
              </div>
              {gradeList.length > 0 && (() => {
                const avg = Math.round(gradeList.reduce((s, g) => s + Math.round(((g.score ?? 0) / (g.max_score || 1)) * 100), 0) / gradeList.length)
                return (
                  <div className="flex items-center justify-between px-5 py-3.5">
                    <span className="text-[13px] text-fg-secondary">Average grade</span>
                    <span className={`text-[13px] font-semibold ${avg >= 60 ? 'text-accent' : 'text-error'}`}>
                      {avg}%
                    </span>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
