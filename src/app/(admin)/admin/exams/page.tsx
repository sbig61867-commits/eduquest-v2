export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { redirect } from 'next/navigation'
import { ClipboardList, ShieldCheck, Eye, EyeOff, Users, FileText } from 'lucide-react'
import { formatDate } from '@/lib/utils'

// Institution-wide exam + homework browser for university_admin.
// Homework and formal exams live in the same `exams` table, separated by
// `type` (with a sentinel duration for untimed homework), so this page
// splits them into two sections rather than showing one ambiguous list.
interface ExamRow {
  id: string
  title: string
  type: string | null
  duration_minutes: number
  is_published: boolean
  proctoring_enabled: boolean
  created_at: string
  teacher_name: string | null
  group_name: string | null
  submission_count: number
}

const isHomework = (e: ExamRow) =>
  e.type === 'homework' || e.duration_minutes <= 0 || e.duration_minutes >= 43200

type T = Awaited<ReturnType<typeof getTranslations<'admin.content'>>>

function Table({ rows, homework, t, locale }: { rows: ExamRow[]; homework: boolean; t: T; locale: Locale }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{homework ? t('exams.thHomework') : t('exams.thExam')}</th>
            <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">{t('common.teacher')}</th>
            <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">{t('common.group')}</th>
            <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('exams.thSubmissions')}</th>
            <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('common.status')}</th>
            <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden xl:table-cell">{t('common.createdAt')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map(exam => (
            <tr key={exam.id} className="hover:bg-slate-800/50 transition-colors">
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${homework ? 'bg-amber-600/20' : 'bg-blue-600/20'}`}>
                    {homework
                      ? <FileText className="w-4 h-4 text-amber-400" />
                      : <ClipboardList className="w-4 h-4 text-blue-400" />}
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{exam.title}</p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {isHomework(exam) ? t('exams.untimed') : t('exams.minutes', { count: exam.duration_minutes })}
                      {exam.proctoring_enabled && (
                        <span className="text-blue-400 inline-flex items-center gap-1 ms-2">
                          <ShieldCheck className="w-3 h-3" />{t('exams.proctored')}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-4 hidden md:table-cell text-slate-300 text-sm">{exam.teacher_name ?? '—'}</td>
              <td className="px-5 py-4 hidden lg:table-cell">
                <span className="text-slate-300 text-sm flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-500" />{exam.group_name ?? '—'}
                </span>
              </td>
              <td className="px-5 py-4 text-slate-300 text-sm">{exam.submission_count ?? 0}</td>
              <td className="px-5 py-4">
                {exam.is_published ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                    <Eye className="w-3.5 h-3.5" />{t('common.published')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs font-medium">
                    <EyeOff className="w-3.5 h-3.5" />{t('common.draft')}
                  </span>
                )}
              </td>
              <td className="px-5 py-4 hidden xl:table-cell text-slate-500 text-sm">{formatDate(exam.created_at, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function AdminExamsPage() {
  const t = await getTranslations('admin.content')
  const locale = (await getLocale()) as Locale
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: raw } = await supabase.rpc('get_admin_exams')

  const all = (raw ?? []) as unknown as ExamRow[]
  const homework = all.filter(isHomework)
  const exams = all.filter(e => !isHomework(e))
  const submissions = all.reduce((s, e) => s + (e.submission_count ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('exams.title')}</h2>
        <p className="text-slate-400 mt-1">
          {t('exams.summary', { exams: exams.length, homework: homework.length, submissions })}
        </p>
      </div>

      {all.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('exams.empty')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('exams.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {exams.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">🕒 {t('exams.sectionExams')}</h3>
              <Table rows={exams} homework={false} t={t} locale={locale} />
            </div>
          )}
          {homework.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">📋 {t('exams.sectionHomework')}</h3>
              <Table rows={homework} homework t={t} locale={locale} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
