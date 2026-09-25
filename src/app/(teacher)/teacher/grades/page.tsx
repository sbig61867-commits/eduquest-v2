export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BarChart2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Question } from '@/types'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'

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

function gradeLabel(pct: number, t: Awaited<ReturnType<typeof getTranslations<'teacher'>>>) {
  if (pct >= 90) return { label: t('grades.gradeExcellent'), color: 'text-emerald-400', bar: 'bg-emerald-500', pass: true }
  if (pct >= 80) return { label: t('grades.gradeVeryGood'), color: 'text-emerald-400', bar: 'bg-emerald-500', pass: true }
  if (pct >= 70) return { label: t('grades.gradeGood'), color: 'text-blue-400', bar: 'bg-blue-500', pass: true }
  if (pct >= 60) return { label: t('grades.gradePass'), color: 'text-amber-400', bar: 'bg-amber-500', pass: true }
  return { label: t('grades.gradeFail'), color: 'text-red-400', bar: 'bg-red-500', pass: false }
}

export default async function TeacherGradesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')
  const t = await getTranslations('teacher')
  const locale = (await getLocale()) as Locale

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
    return { ...s, max, pct, grade: gradeLabel(pct, t) }
  })

  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : null
  const passed = rows.filter(r => r.grade.pass).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('grades.title')}</h2>
        <p className="text-slate-400 mt-1">{rows.length}</p>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BarChart2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('grades.noGrades')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('grades.noGradesHint')}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs mb-1">{t('grades.avg')}</p>
              <p className="text-2xl font-bold text-white">{avg}%</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs mb-1">{t('grades.passing')}</p>
              <p className="text-2xl font-bold text-emerald-400">{passed}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs mb-1">{t('grades.failing')}</p>
              <p className="text-2xl font-bold text-red-400">{rows.length - passed}</p>
            </div>
          </div>

          <div className="space-y-2.5">
            {rows.map(r => (
              <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{r.users?.full_name ?? '—'}</p>
                  <p className="text-slate-500 text-xs truncate">{r.exams?.title ?? '—'} · {formatDate(r.submitted_at, locale)}</p>
                  <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden max-w-xs">
                    <div className={`h-full rounded-full ${r.grade.bar}`} style={{ width: `${r.pct}%` }} />
                  </div>
                </div>
                <div className="text-center shrink-0">
                  <p className={`text-3xl font-extrabold leading-none ${r.grade.color}`}>{r.pct}%</p>
                  <p className={`text-xs font-semibold mt-1 ${r.grade.color}`}>{r.grade.label}</p>
                  <p className="text-slate-600 text-[11px] mt-0.5">{t('grades.outOf', { score: r.score, max: r.max })}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
