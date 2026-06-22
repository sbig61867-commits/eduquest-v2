export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { BarChart2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { redirect } from 'next/navigation'

export default async function TeacherGradesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: submissions } = await supabase
    .from('exam_submissions')
    .select('*, exams!inner(title, teacher_id, questions), users(full_name, email)')
    .eq('exams.teacher_id', user.id)
    .not('score', 'is', null)
    .order('submitted_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Student Grades</h2>
        <p className="text-slate-400 mt-1">{submissions?.length ?? 0} graded submissions</p>
      </div>

      {!submissions?.length ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BarChart2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No graded submissions yet.</p>
          <p className="text-slate-500 text-sm mt-1">Grades appear after students complete your exams.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Student</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Exam</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Score</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Date</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {submissions.map(sub => {
                const max = (sub.exams as any)?.questions?.reduce((a: number, q: any) => a + q.points, 0) || 1
                const pct = Math.round((sub.score / max) * 100)
                const passed = pct >= 60
                return (
                  <tr key={sub.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="text-white text-sm font-medium">{(sub.users as any)?.full_name ?? '—'}</p>
                      <p className="text-slate-500 text-xs">{(sub.users as any)?.email ?? ''}</p>
                    </td>
                    <td className="px-5 py-4 text-slate-300 text-sm">{(sub.exams as any)?.title ?? '—'}</td>
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
