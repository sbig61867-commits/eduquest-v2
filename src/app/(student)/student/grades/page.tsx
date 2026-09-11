export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BarChart2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'
import { EmptyState } from '@/components/ui/empty-state'
import type { Question } from '@/types'

interface RawSubmission {
  id: string
  exam_id: string
  score: number
  max_score: number | null
  submitted_at: string
}
interface RpcExam { id: string; title: string; duration_minutes: number; questions: Question[] }

export default async function GradesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [{ data: raw }, { data: rpcExams }] = await Promise.all([
    supabase
      .from('exam_submissions')
      .select('id, exam_id, score, max_score, submitted_at')
      .eq('student_id', user.id)
      .not('score', 'is', null)
      .order('submitted_at', { ascending: false }),
    supabase.rpc('get_student_exams'),
  ])

  const examMap = new Map<string, RpcExam>(
    ((rpcExams ?? []) as RpcExam[]).map(e => [e.id, e])
  )
  const isHomework = (e?: RpcExam) => !!e && (e.duration_minutes <= 0 || e.duration_minutes >= 43200)

  const submissions = ((raw ?? []) as RawSubmission[]).map(sub => {
    const exam = examMap.get(sub.exam_id)
    const max = sub.max_score
      ?? exam?.questions?.reduce((a, q) => a + (q.points ?? 0), 0)
      ?? 1
    return {
      ...sub,
      title: exam?.title ?? '·',
      homework: isHomework(exam),
      max,
      pct: Math.round(((sub.score ?? 0) / (max || 1)) * 100),
    }
  })

  const avg = submissions.length
    ? Math.round(submissions.reduce((s, sub) => s + sub.pct, 0) / submissions.length)
    : null
  const passed = submissions.filter(s => s.pct >= 60).length

  return (
    <>
      <PageTitle title="Grades" />

      <div className="max-w-3xl mx-auto">
        {/* Page header */}
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-fg">Grades</h1>
          <p className="text-[13px] text-fg-muted mt-1.5">
            {submissions.length} graded {submissions.length === 1 ? 'submission' : 'submissions'}
          </p>
        </div>

        {/* Summary strip — text-only, no decorative cards */}
        {avg !== null && (
          <div className="flex items-center gap-6 mb-7 pb-7 border-b border-border">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted mb-1">Average</p>
              <p className={`text-2xl font-semibold ${avg >= 60 ? 'text-accent' : 'text-error'}`}>{avg}%</p>
            </div>
            <div className="w-px h-8 bg-border" aria-hidden="true" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted mb-1">Passed</p>
              <p className="text-2xl font-semibold text-fg">{passed} / {submissions.length}</p>
            </div>
            <div className="w-px h-8 bg-border" aria-hidden="true" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted mb-1">Pass rate</p>
              <p className="text-2xl font-semibold text-fg">
                {submissions.length ? Math.round((passed / submissions.length) * 100) : 0}%
              </p>
            </div>
          </div>
        )}

        {!submissions.length ? (
          <EmptyState
            icon={BarChart2}
            title="No grades yet"
            description="Take an exam to see your results here."
          />
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-border">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Exam</span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Score</span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted hidden sm:block">Date</span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Result</span>
            </div>

            <ul className="divide-y divide-border">
              {submissions.map(sub => {
                const isPassed = sub.pct >= 60
                return (
                  <li key={sub.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-5 py-4 hover:bg-canvas transition-colors">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-fg truncate">{sub.title}</p>
                      <Badge variant={sub.homework ? 'info' : 'neutral'} className="mt-1 text-[10px]">
                        {sub.homework ? 'Homework' : 'Exam'}
                      </Badge>
                    </div>
                    <div className="text-end">
                      <p className={`text-[13px] font-semibold ${isPassed ? 'text-accent' : 'text-error'}`}>
                        {sub.score}/{sub.max}
                      </p>
                      <p className="text-[11px] text-fg-muted">{sub.pct}%</p>
                    </div>
                    <p className="text-[12px] text-fg-muted hidden sm:block whitespace-nowrap">
                      {formatDate(sub.submitted_at)}
                    </p>
                    <Badge variant={isPassed ? 'success' : 'error'}>
                      {isPassed ? 'Passed' : 'Failed'}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}
