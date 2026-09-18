export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BarChart2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import type { Question } from '@/types'
import { AppealButton, type AppealSummary } from '@/components/student/appeal-panel'

interface RawSubmission {
  id: string
  exam_id: string
  score: number
  max_score: number | null
  submitted_at: string
  proctoring_events: Array<{ type?: string }> | null
}
interface RpcExam { id: string; title: string; duration_minutes: number; questions: Question[] }

export default async function GradesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Students have no direct SELECT on exams (answers must never leak), so a
  // joined `exams(title)` comes back null. Titles/questions come from the
  // get_student_exams RPC instead (answer-stripped, enrollment-scoped).
  const [{ data: raw }, { data: rpcExams }] = await Promise.all([
    supabase
      .from('exam_submissions')
      .select('id, exam_id, score, max_score, submitted_at, proctoring_events')
      .eq('student_id', user.id)
      .not('score', 'is', null)
      .order('submitted_at', { ascending: false }),
    supabase.rpc('get_student_exams'),
  ])

  // A student has no RLS read on exam_appeals rows other than their own
  // (student_id = auth.uid()), so this is a direct, un-elevated query.
  const submissionIds = (raw ?? []).map(s => s.id)
  const { data: appeals } = submissionIds.length
    ? await supabase
        .from('exam_appeals')
        .select('id, submission_id, status, student_message, teacher_response, created_at, resolved_at')
        .in('submission_id', submissionIds)
    : { data: [] as never[] }
  const appealMap = new Map<string, AppealSummary>(
    (appeals ?? []).map(a => [a.submission_id, a as unknown as AppealSummary])
  )

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
      title: exam?.title ?? '—',
      homework: isHomework(exam),
      max,
      pct: Math.round(((sub.score ?? 0) / (max || 1)) * 100),
      flagged: (sub.proctoring_events ?? []).some(e => e.type !== 'detector_unavailable'),
    }
  })

  const avg = submissions.length
    ? Math.round(submissions.reduce((s, sub) => s + sub.pct, 0) / submissions.length)
    : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">درجاتي</h2>
        <p className="text-slate-400 mt-1">{submissions.length} graded exams</p>
      </div>

      {avg !== null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-slate-400 text-sm mb-1">متوسط الدرجات</p>
            <p className={`text-3xl font-bold ${avg >= 70 ? 'text-emerald-400' : avg >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{avg}%</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-slate-400 text-sm mb-1">الاختبارات المؤدّاة</p>
            <p className="text-3xl font-bold text-white">{submissions.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-slate-400 text-sm mb-1">ناجح</p>
            <p className="text-3xl font-bold text-emerald-400">
              {submissions.filter(s => s.pct >= 60).length}
            </p>
          </div>
        </div>
      )}

      {!submissions.length ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BarChart2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">لا توجد درجات بعد. أدِّ اختباراً لترى نتائجك.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">اختبار</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">الدرجة</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">التاريخ</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">النتيجة</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">مراقبة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {submissions.map(sub => {
                const passed = sub.pct >= 60
                return (
                  <tr key={sub.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-4 text-white text-sm font-medium">
                      <Badge variant={sub.homework ? 'blue' : 'gray'}>{sub.homework ? 'واجب' : 'اختبار'}</Badge>
                      <span className="ms-2">{sub.title}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-sm font-bold ${passed ? 'text-emerald-400' : 'text-red-400'}`}>
                        {sub.score}/{sub.max} ({sub.pct}%)
                      </span>
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell text-slate-400 text-sm">{formatDate(sub.submitted_at)}</td>
                    <td className="px-5 py-4"><Badge variant={passed ? 'green' : 'red'}>{passed ? 'ناجح' : 'راسب'}</Badge></td>
                    <td className="px-5 py-4">
                      {sub.flagged && (
                        <AppealButton submissionId={sub.id} existing={appealMap.get(sub.id) ?? null} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
