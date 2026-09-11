export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { PageTitle } from '@/components/shared/page-title'
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

function Table({ rows, homework }: { rows: ExamRow[]; homework: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">{homework ? 'Homework' : 'Exam'}</th>
            <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden md:table-cell">Teacher</th>
            <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Group</th>
            <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Submissions</th>
            <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Status</th>
            <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(exam => (
            <tr key={exam.id} className="hover:bg-surface/50 transition-colors">
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${homework ? 'bg-accent-subtle' : 'bg-accent-subtle'}`}>
                    {homework
                      ? <FileText className="w-4 h-4 text-accent" />
                      : <ClipboardList className="w-4 h-4 text-accent" />}
                  </div>
                  <div>
                    <p className="text-fg text-sm font-medium">{exam.title}</p>
                    <p className="text-fg-muted text-xs mt-0.5">
                      {isHomework(exam) ? 'بدون مؤقت' : `${exam.duration_minutes} min`}
                      {exam.proctoring_enabled && (
                        <span className="text-accent inline-flex items-center gap-1 ml-2">
                          <ShieldCheck className="w-3 h-3" />Proctored
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-4 hidden md:table-cell text-fg-secondary text-sm">{exam.teacher_name ?? '·'}</td>
              <td className="px-5 py-4 hidden lg:table-cell">
                <span className="text-fg-secondary text-sm flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-fg-muted" />{exam.group_name ?? '·'}
                </span>
              </td>
              <td className="px-5 py-4 text-fg-secondary text-sm">{exam.submission_count ?? 0}</td>
              <td className="px-5 py-4">
                {exam.is_published ? (
                  <span className="inline-flex items-center gap-1.5 text-accent text-xs font-medium">
                    <Eye className="w-3.5 h-3.5" />Published
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-fg-muted text-xs font-medium">
                    <EyeOff className="w-3.5 h-3.5" />Draft
                  </span>
                )}
              </td>
              <td className="px-5 py-4 hidden xl:table-cell text-fg-muted text-sm">{formatDate(exam.created_at)}</td>
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

  const { data: raw } = await supabase.rpc('get_admin_exams')

  const all = (raw ?? []) as unknown as ExamRow[]
  const homework = all.filter(isHomework)
  const exams = all.filter(e => !isHomework(e))
  const submissions = all.reduce((s, e) => s + (e.submission_count ?? 0), 0)

  return (
    <>
      <PageTitle title="Exams" />
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-fg">Exams &amp; Homework</h2>
        <p className="text-fg-secondary mt-1">
          {exams.length} exam{exams.length === 1 ? '' : 's'} · {homework.length} homework · {submissions} submission{submissions === 1 ? '' : 's'}
        </p>
      </div>

      {all.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <ClipboardList className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No exams or homework yet.</p>
          <p className="text-fg-muted text-sm mt-1">Teachers create these from their own panel.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {exams.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider">🕒 Exams</h3>
              <Table rows={exams} homework={false} />
            </div>
          )}
          {homework.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider">📋 Homework &amp; Activities</h3>
              <Table rows={homework} homework />
            </div>
          )}
        </div>
      )}
    </div>
    </>
  )
}
