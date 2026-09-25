export const dynamic = 'force-dynamic'

import { getTranslations } from 'next-intl/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'

// Read-only. attendance_records_select already narrows rows to
// `student_id = auth.uid()`, and the joined session/group rows are readable
// only for groups the student belongs to — the .eq('student_id') below is
// defense-in-depth, not the isolation itself.

type Status = 'present' | 'late' | 'absent' | 'excused'

// Colours only. The label is looked up per request from the `student`
// namespace — a module-level constant would be evaluated once at import and
// would pin whichever locale rendered first for every later request.
const STATUS_CLS: Record<Status, string> = {
  present: 'text-emerald-400 bg-emerald-500/10',
  late:    'text-amber-400 bg-amber-500/10',
  absent:  'text-rose-400 bg-rose-500/10',
  excused: 'text-slate-300 bg-slate-500/15',
}

interface RecordRow {
  status: Status
  note: string | null
  attendance_sessions: {
    session_date: string
    title: string | null
    groups: { name: string } | null
  } | null
}

export default async function StudentAttendancePage() {
  const t = await getTranslations('student.attendance')
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('attendance_records')
    .select('status, note, attendance_sessions!inner(session_date, title, groups(name))')
    .eq('student_id', user.id)
    .order('marked_at', { ascending: false })
    .limit(200)

  const rows = ((data ?? []) as unknown as RecordRow[])
    .filter(r => r.attendance_sessions)
    .sort((a, b) => (a.attendance_sessions!.session_date < b.attendance_sessions!.session_date ? 1 : -1))

  // Rate counts excused sessions as neither attended nor missed, so an
  // approved absence never lowers the percentage.
  const counts = { present: 0, late: 0, absent: 0, excused: 0 }
  for (const r of rows) counts[r.status]++
  const counted = counts.present + counts.late + counts.absent
  const rate = counted ? Math.round(((counts.present + counts.late) / counted) * 100) : null

  const tone = rate === null ? 'text-slate-400' : rate >= 85 ? 'text-emerald-400' : rate >= 75 ? 'text-amber-400' : 'text-rose-400'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <ClipboardCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('empty')}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs">{t('rate')}</p>
              <p className={`text-2xl font-bold tabular-nums mt-1 ${tone}`}>{rate === null ? '—' : `${rate}%`}</p>
              <p className="text-slate-500 text-[11px] mt-1">{t('countedSessions', { count: counted })}</p>
            </div>
            {(Object.keys(STATUS_CLS) as Status[]).map(k => (
              <div key={k} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-slate-400 text-xs">{t(`status.${k}`)}</p>
                <p className="text-2xl font-bold text-white tabular-nums mt-1">{counts[k]}</p>
              </div>
            ))}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
            {rows.map((r, i) => {
              const s = r.attendance_sessions!
              return (
                <div key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-white">
                      {s.session_date}
                      {s.title && <span className="text-slate-500"> · {s.title}</span>}
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {s.groups?.name ?? '—'}
                      {r.note && <span> · {r.note}</span>}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full ${STATUS_CLS[r.status]}`}>
                    {t(`status.${r.status}`)}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
