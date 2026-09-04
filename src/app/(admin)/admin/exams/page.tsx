export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
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
  teacher: { full_name: string | null } | null
  groups: { name: string } | null
  exam_submissions: { count: number }[]
}

const isHomework = (e: ExamRow) =>
  e.type === 'homework' || e.duration_minutes <= 0 || e.duration_minutes >= 43200

function Table({ rows, homework }: { rows: ExamRow[]; homework: boolean }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{homework ? 'Homework' : 'Exam'}</th>
            <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Teacher</th>
            <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Group</th>
            <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Submissions</th>
            <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Status</th>
            <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Created</th>
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
                      {isHomework(exam) ? 'بدون مؤقت' : `${exam.duration_minutes} min`}
                      {exam.proctoring_enabled && (
                        <span className="text-blue-400 inline-flex items-center gap-1 ml-2">
                          <ShieldCheck className="w-3 h-3" />Proctored
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-4 hidden md:table-cell text-slate-300 text-sm">{exam.teacher?.full_name ?? '—'}</td>
              <td className="px-5 py-4 hidden lg:table-cell">
                <span className="text-slate-300 text-sm flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-500" />{exam.groups?.name ?? '—'}
                </span>
              </td>
              <td className="px-5 py-4 text-slate-300 text-sm">{exam.exam_submissions?.[0]?.count ?? 0}</td>
              <td className="px-5 py-4">
                {exam.is_published ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                    <Eye className="w-3.5 h-3.5" />Published
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs font-medium">
                    <EyeOff className="w-3.5 h-3.5" />Draft
                  </span>
                )}
              </td>
              <td className="px-5 py-4 hidden xl:table-cell text-slate-500 text-sm">{formatDate(exam.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function AdminExamsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: raw } = await supabase
    .from('exams')
    .select(`
      id, title, type, duration_minutes, is_published, proctoring_enabled, created_at,
      teacher:users!exams_teacher_id_fkey(full_name),
      groups(name),
      exam_submissions(count)
    `)
    .eq('tenant_id', user.tenant_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const all = (raw ?? []) as unknown as ExamRow[]
  const homework = all.filter(isHomework)
  const exams = all.filter(e => !isHomework(e))
  const submissions = all.reduce((s, e) => s + (e.exam_submissions?.[0]?.count ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Exams &amp; Homework</h2>
        <p className="text-slate-400 mt-1">
          {exams.length} exam{exams.length === 1 ? '' : 's'} · {homework.length} homework · {submissions} submission{submissions === 1 ? '' : 's'}
        </p>
      </div>

      {all.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No exams or homework yet.</p>
          <p className="text-slate-500 text-sm mt-1">Teachers create these from their own panel.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {exams.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">🕒 Exams</h3>
              <Table rows={exams} homework={false} />
            </div>
          )}
          {homework.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">📋 Homework &amp; Activities</h3>
              <Table rows={homework} homework />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
