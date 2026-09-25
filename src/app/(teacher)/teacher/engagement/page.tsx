export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { loadGroupEngagement, engagementTone } from '@/lib/engagement'
import { Activity } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

const PERIODS = [7, 30, 90]

export default async function TeacherEngagementPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; days?: string }>
}) {
  const { group, days } = await searchParams
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')
  const t = await getTranslations('teacher')

  const { data: groupRows } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tenant_id', user.tenant_id)
    .eq('teacher_id', user.id)
    .eq('is_active', true)
    .order('name')

  const groups = (groupRows ?? []).map(g => ({ id: g.id as string, name: g.name as string }))
  const period = PERIODS.includes(Number(days)) ? Number(days) : 30
  const activeId = groups.some(g => g.id === group) ? group! : groups[0]?.id
  const data = activeId ? await loadGroupEngagement(supabase, activeId, period) : null

  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(new Date(iso)) : '—'
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('engagement.title')}</h2>
        <p className="text-slate-400 mt-1">{t('engagement.subtitle')}</p>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Activity className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('engagement.noGroups')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {groups.map(g => (
              <Link key={g.id} href={`/teacher/engagement?group=${g.id}&days=${period}`}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  g.id === activeId
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}>{g.name}</Link>
            ))}
            <span className="mx-2 h-5 w-px bg-slate-700" />
            {PERIODS.map(d => (
              <Link key={d} href={`/teacher/engagement?group=${activeId}&days=${d}`}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  d === period
                    ? 'bg-slate-700 border-slate-600 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                }`}>{t('engagement.days', { d })}</Link>
            ))}
          </div>

          {!data ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-slate-400 text-sm">
              {t('engagement.migrationHint')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-slate-400 text-xs">{t('engagement.stats.avgEngagement')}</p>
                  <p className={`text-2xl font-bold tabular-nums mt-1 ${engagementTone(data.summary.avg_engagement)}`}>
                    {pct(data.summary.avg_engagement)}
                  </p>
                  <p className="text-slate-500 text-[11px] mt-1">{t('engagement.stats.students', { count: data.summary.students })}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-slate-400 text-xs">{t('engagement.stats.taskSubmission')}</p>
                  <p className="text-2xl font-bold text-white tabular-nums mt-1">{pct(data.summary.avg_task_pct)}</p>
                  <p className="text-slate-500 text-[11px] mt-1">{t('engagement.stats.assigned', { count: data.summary.assigned })}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-slate-400 text-xs">{t('engagement.stats.inactive')}</p>
                  <p className="text-2xl font-bold text-rose-400 tabular-nums mt-1">{data.summary.inactive}</p>
                  <p className="text-slate-500 text-[11px] mt-1">{t('engagement.stats.atRisk', { count: data.summary.at_risk })}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-slate-400 text-xs">{t('engagement.stats.thriving')}</p>
                  <p className="text-2xl font-bold text-emerald-400 tabular-nums mt-1">{data.summary.thriving}</p>
                  <p className="text-slate-500 text-[11px] mt-1">{t('engagement.stats.above85')}</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-400 text-xs border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3 text-start font-medium">{t('engagement.table.student')}</th>
                      <th className="px-5 py-3 text-end font-medium">{t('engagement.table.engagement')}</th>
                      <th className="px-5 py-3 text-end font-medium">{t('engagement.table.tasks')}</th>
                      <th className="px-5 py-3 text-end font-medium">{t('engagement.table.course')}</th>
                      <th className="px-5 py-3 text-end font-medium">{t('engagement.table.activeDays')}</th>
                      <th className="px-5 py-3 text-end font-medium">{t('engagement.table.lastActive')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.students.length === 0 && (
                      <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">{t('engagement.table.noStudents')}</td></tr>
                    )}
                    {data.students.map(s => (
                      <tr key={s.student_id}>
                        <td className={`px-5 py-3 ${s.is_active ? 'text-white' : 'text-slate-500 line-through'}`}>{s.full_name}</td>
                        <td className={`px-5 py-3 text-end tabular-nums font-semibold ${engagementTone(s.engagement_pct)}`}>
                          {pct(s.engagement_pct)}
                        </td>
                        <td className="px-5 py-3 text-end tabular-nums text-slate-300">{s.submitted}/{s.assigned}</td>
                        <td className="px-5 py-3 text-end tabular-nums text-slate-300">
                          {s.course_total === 0 ? '—' : `${s.course_done}/${s.course_total}`}
                        </td>
                        <td className="px-5 py-3 text-end tabular-nums text-slate-300">{s.active_days}</td>
                        <td className="px-5 py-3 text-end text-slate-400 text-xs">{fmtDate(s.last_active_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-slate-500 text-xs">{t('engagement.formula', { days: period })}</p>
            </>
          )}
        </>
      )}
    </div>
  )
}
