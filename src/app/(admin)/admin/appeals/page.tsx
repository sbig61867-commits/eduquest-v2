export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Gavel } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import { ReportDownloadButton } from '@/components/admin/report-download-button'

const STATUS_BADGE: Record<string, { variant: 'yellow' | 'green' | 'red'; label: string }> = {
  pending:  { variant: 'yellow', label: 'قيد المراجعة' },
  upheld:   { variant: 'green', label: 'قُبل الطعن' },
  rejected: { variant: 'red',   label: 'رُفض الطعن' },
}

// university_admin sees every appeal in their tenant — exam_appeals_select
// already scopes that (no service-role client needed for a plain read).
export default async function AdminAppealsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: appeals } = await supabase
    .from('exam_appeals')
    .select('id, student_name, teacher_name, exam_title, group_name, violation_type, student_message, teacher_response, status, created_at, resolved_at')
    .order('created_at', { ascending: false })

  const rows = appeals ?? []
  const pending = rows.filter(a => a.status === 'pending').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">طعونات المراقبة</h2>
          <p className="text-slate-400 mt-1">{rows.length} طعناً إجمالاً · {pending} قيد المراجعة</p>
        </div>
        <ReportDownloadButton />
      </div>

      {!rows.length ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Gavel className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">لا توجد طعونات مسجَّلة بعد.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(a => {
            const s = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending
            return (
              <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white font-medium">{a.student_name} · {a.exam_title}</p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {a.group_name} · المعلم المراقِب: {a.teacher_name} · {a.violation_type ?? 'طعن عام'} · {formatDateTime(a.created_at)}
                    </p>
                  </div>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </div>
                <p className="text-slate-300 text-sm bg-slate-800/50 rounded-lg p-3">{a.student_message}</p>
                {a.teacher_response && (
                  <p className="text-slate-400 text-xs">
                    رد المعلم ({a.resolved_at ? formatDateTime(a.resolved_at) : ''}): {a.teacher_response}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
