export const dynamic = 'force-dynamic'

import { getTranslations } from 'next-intl/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ScheduleGrid } from '@/components/schedules/schedule-grid'
import { loadStudentSchedule } from '@/lib/schedules-data'

// Students have no direct row read on schedules — get_student_schedule()
// returns only published timetables for the groups they are enrolled in.
export default async function StudentSchedulePage() {
  const t = await getTranslations('student.schedule')
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const slots = await loadStudentSchedule(supabase)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>
      <ScheduleGrid slots={slots} showGroup emptyText={t('empty')} />
    </div>
  )
}
