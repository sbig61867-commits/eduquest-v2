export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BarChart2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import type { Question } from '@/types'

interface ExamRow { title: string; questions: Question[] }
interface SubmissionRow {
  id: string
  score: number
  submitted_at: string
  exams: ExamRow | null
}

function calcMax(questions: Question[] | undefined): number {
  return questions?.reduce((a, q) => a + q.points, 0) || 1
}

export default async function GradesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: raw } = await supabase
    .from('exam_submissions')
    .select('id, score, submitted_at, exams(title, questions)')
    .eq('student_id', user.id)
    .not('score', 'is', null)
    .order('submitted_at', { ascending: false })

  const submissions = (raw ?? []) as unknown as SubmissionRow[]

  const avg = submissions.length
    ? Math.round(submissions.reduce((s, sub) => {
        const max = calcMax(sub.exams?.questions)
        return s + ((sub.score ?? 0) / max) * 100
      }, 0) / submissions.length)
    : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">My Grades</h2>
        <p className="text-slate-400 mt-1">{submissions.length} graded exams</p>
      </div>

      {avg !== null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-slate-400 text-sm mb-1">Average Score</p>
            <p className={`text-3xl font-bold ${avg >= 70 ? 'text-emerald-400' : avg >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{avg}%</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-slate-400 text-sm mb-1">Exams Taken</p>
            <p className="text-3xl font-bold text-white">{submissions.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-slate-400 text-sm mb-1">Passed</p>
            <p className="text-3xl font-bold text-emerald-400">
              {submissions.filter(s => ((s.score ?? 0) / calcMax(s.exams?.questions)) * 100 >= 60).length}
            </p>
          </div>
        </div>
      )}

      {!submissions.length ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BarChart2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No grades yet. Take an exam to see your results.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Exam</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Score</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Date</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {submissions.map(sub => {
                const max = calcMax(sub.exams?.questions)
                const pct = Math.round(((sub.score ?? 0) / max) * 100)
                const passed = pct >= 60
                return (
                  <tr key={sub.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-4 text-white text-sm font-medium">{sub.exams?.title ?? '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`text-sm font-bold ${passed ? 'text-emerald-400' : 'text-red-400'}`}>
                        {sub.score}/{max} ({pct}%)
                      </span>
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell text-slate-400 text-sm">{formatDate(sub.submitted_at)}</td>
                    <td className="px-5 py-4"><Badge variant={passed ? 'green' : 'red'}>{passed ? 'Passed' : 'Failed'}</Badge></td>
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
