export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BarChart2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Question } from '@/types'
import { PageTitle } from '@/components/shared/page-title'

interface ExamRow { title: string; teacher_id: string; questions: Question[] }
interface UserRow  { full_name: string; email: string }
interface SubmissionRow {
  id: string
  score: number
  max_score: number | null
  submitted_at: string
  exams: ExamRow | null
  users: UserRow | null
}

// Simple, universal grade scale (percentage → Arabic descriptor + color).
function gradeOf(pct: number) {
  if (pct >= 90) return { label: 'ممتاز', color: 'text-accent', bar: 'bg-success', pass: true }
  if (pct >= 80) return { label: 'جيد جداً', color: 'text-accent', bar: 'bg-success', pass: true }
  if (pct >= 70) return { label: 'جيد', color: 'text-accent', bar: 'bg-accent', pass: true }
  if (pct >= 60) return { label: 'مقبول', color: 'text-accent', bar: 'bg-warning', pass: true }
  return { label: 'راسب', color: 'text-error', bar: 'bg-error', pass: false }
}

export default async function TeacherGradesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: raw } = await supabase
    .from('exam_submissions')
    .select('id, score, max_score, submitted_at, exams!inner(title, teacher_id, questions), users(full_name, email)')
    .eq('exams.teacher_id', user.id)
    .not('score', 'is', null)
    .order('submitted_at', { ascending: false })

  const submissions = (raw ?? []) as unknown as SubmissionRow[]

  const rows = submissions.map(s => {
    const max = s.max_score ?? s.exams?.questions?.reduce((a, q) => a + (q.points ?? 0), 0) ?? 1
    const pct = Math.round(((s.score ?? 0) / (max || 1)) * 100)
    return { ...s, max, pct, grade: gradeOf(pct) }
  })

  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : null
  const passed = rows.filter(r => r.grade.pass).length

  return (
    <>
      <PageTitle title="Grades" />
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-fg">Student Grades</h1>
        <p className="text-[13px] text-fg-muted mt-1.5">{rows.length} graded submissions</p>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <BarChart2 className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No graded submissions yet.</p>
          <p className="text-fg-muted text-sm mt-1">Grades appear after students complete your exams.</p>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="flex items-center gap-6 pb-6 border-b border-border flex-wrap">
            <div>
              <p className="text-2xl font-semibold text-fg leading-none">{avg}%</p>
              <p className="text-[12px] text-fg-muted mt-1">المعدّل العام</p>
            </div>
            <div className="w-px h-8 bg-border hidden sm:block" aria-hidden="true" />
            <div>
              <p className="text-2xl font-semibold text-accent leading-none">{passed}</p>
              <p className="text-[12px] text-fg-muted mt-1">ناجحون</p>
            </div>
            <div className="w-px h-8 bg-border hidden sm:block" aria-hidden="true" />
            <div>
              <p className="text-2xl font-semibold text-error leading-none">{rows.length - passed}</p>
              <p className="text-[12px] text-fg-muted mt-1">راسبون</p>
            </div>
          </div>

          {/* Grade cards — percentage-led, one clear number per student */}
          <div className="space-y-2.5">
            {rows.map(r => (
              <div key={r.id} className="bg-surface border border-border rounded-lg p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-fg font-medium truncate">{r.users?.full_name ?? '·'}</p>
                  <p className="text-fg-muted text-xs truncate">{r.exams?.title ?? '·'} · {formatDate(r.submitted_at)}</p>
                  {/* progress bar */}
                  <div className="mt-2 h-1.5 bg-surface rounded-full overflow-hidden max-w-xs">
                    <div className={`h-full rounded-full ${r.grade.bar}`} style={{ width: `${r.pct}%` }} />
                  </div>
                </div>
                <div className="text-center shrink-0">
                  <p className={`text-3xl font-extrabold leading-none ${r.grade.color}`}>{r.pct}%</p>
                  <p className={`text-xs font-semibold mt-1 ${r.grade.color}`}>{r.grade.label}</p>
                  <p className="text-fg-muted text-[11px] mt-0.5">{r.score} من {r.max}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
    </>
  )
}
