export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { BookOpen, ClipboardList, BarChart2, ArrowRight } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { SurveyCard } from '@/components/student/survey-card'
import { AnnouncementsBanner, type StudentAnnouncement } from '@/components/student/announcements-banner'

interface LessonRow { id: string; title: string; created_at: string; groups: { name: string } | null }
interface GradeRow { id: string; score: number; max_score: number; exams: { title: string } | null }

export default async function StudentDashboard() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)

  const { data: groupRows } = await supabase
    .from('group_students')
    .select('group_id')
    .eq('student_id', user?.id ?? '')
  const groupIds = (groupRows ?? []).map(r => r.group_id)

  const [{ data: recentLessons, count: lessonCount }, { data: examRows }, { count: submissions }, { data: grades }, { data: announcementRows }] = await Promise.all([
    groupIds.length === 0
      ? Promise.resolve({ data: [], count: 0 } as { data: LessonRow[]; count: number })
      : supabase
          .from('lessons')
          .select('id, title, created_at, groups(name)', { count: 'exact' })
          .eq('is_published', true)
          .in('group_id', groupIds)
          .order('created_at', { ascending: false })
          .limit(5),
    supabase.rpc('get_student_exams'),
    supabase.from('exam_submissions').select('*', { count: 'exact', head: true }).eq('student_id', user?.id ?? ''),
    supabase.from('grades').select('id, score, max_score, exams(title)').eq('student_id', user?.id ?? '').order('graded_at', { ascending: false }).limit(5),
    supabase.rpc('get_student_announcements'),
  ])
  const exams = (examRows ?? []).length
  const announcements = (announcementRows ?? []) as unknown as StudentAnnouncement[]
  const lessonList = (recentLessons ?? []) as unknown as LessonRow[]
  const gradeList = (grades ?? []) as unknown as GradeRow[]
  const resumeLesson = lessonList[0] ?? null

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-fg">My Dashboard</h1>

      <AnnouncementsBanner announcements={announcements} />
      <SurveyCard />

      {/* Row 1: Continue learning (8 cols) + this-week strip (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 bg-surface border border-border rounded-lg p-6">
          <p className="text-xs font-medium uppercase tracking-widest text-fg-muted mb-3">Continue Learning</p>
          {resumeLesson ? (
            <Link href="/student/lessons" className="group block">
              <p className="text-lg font-semibold text-fg group-hover:text-accent transition-colors">{resumeLesson.title}</p>
              <p className="text-sm text-fg-muted mt-1">{resumeLesson.groups?.name ?? '—'} · {formatDate(resumeLesson.created_at)}</p>
              <span className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-accent">
                Go to lessons <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          ) : (
            <div>
              <p className="text-fg-muted text-sm">No lessons assigned yet.</p>
              <p className="text-fg-muted text-xs mt-1">Lessons will appear here once a teacher assigns them to your group.</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-surface border border-border rounded-lg p-6 flex flex-col justify-between gap-4">
          <p className="text-xs font-medium uppercase tracking-widest text-fg-muted">Overview</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-fg-secondary">
                <BookOpen className="w-4 h-4 text-accent" /> Lessons available
              </span>
              <span className="text-sm font-semibold text-fg">{lessonCount ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-fg-secondary">
                <ClipboardList className="w-4 h-4 text-accent" /> Exams
              </span>
              <span className="text-sm font-semibold text-fg">{exams}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-fg-secondary">
                <BarChart2 className="w-4 h-4 text-accent" /> Submissions
              </span>
              <span className="text-sm font-semibold text-fg">{submissions ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Grades */}
      <div className="bg-surface border border-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-fg">Recent Grades</h2>
          <Link href="/student/grades" className="text-xs text-accent hover:text-accent-hover transition-colors">View all</Link>
        </div>
        {gradeList.length === 0 ? (
          <p className="text-fg-muted text-sm">No grades yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {gradeList.map(g => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2.5">
                <p className="text-sm text-fg truncate">{g.exams?.title ?? 'Exam'}</p>
                <span className="text-sm font-semibold text-accent shrink-0">{g.score}/{g.max_score}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
