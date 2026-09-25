export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ScheduleGrid } from '@/components/schedules/schedule-grid'
import { loadTeacherSchedules } from '@/lib/schedules-data'
import { CalendarDays, Users, User } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export default async function TeacherSchedulePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')
  const t = await getTranslations('teacher')

  const schedules = await loadTeacherSchedules(supabase, user.tenant_id)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('schedule.title')}</h2>
        <p className="text-slate-400 mt-1">{t('schedule.subtitle')}</p>
      </div>

      {schedules.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <CalendarDays className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('schedule.noSchedules')}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {schedules.map(s => (
            <section key={s.id} className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {s.kind === 'group'
                  ? <Users className="w-4 h-4 text-blue-400" />
                  : <User className="w-4 h-4 text-amber-400" />}
                <h3 className="text-white font-semibold">{s.target_name ?? '—'}</h3>
                <span className="text-slate-500 text-xs">{s.title}</span>
                {s.kind === 'group' && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                    s.is_published ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 bg-slate-500/10'
                  }`}>
                    {s.is_published ? t('schedule.publishedToStudents') : t('schedule.draft')}
                  </span>
                )}
                {s.kind === 'teacher' && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full text-amber-400 bg-amber-500/10">
                    {t('schedule.privateSchedule')}
                  </span>
                )}
              </div>
              <ScheduleGrid slots={s.slots} />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
