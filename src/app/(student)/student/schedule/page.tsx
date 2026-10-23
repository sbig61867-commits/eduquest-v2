export const dynamic = 'force-dynamic'

import { getTranslations } from 'next-intl/server'
import { currentUser } from '@/lib/auth/current'
import { redirect } from 'next/navigation'
import { ScheduleGrid } from '@/components/schedules/schedule-grid'
import { loadStudentSchedule } from '@/lib/schedules-data'

// Students have no direct row read on schedules — get_student_schedule()
// returns only published timetables for the groups they are enrolled in.
export default async function StudentSchedulePage() {
  const t = await getTranslations('student.schedule')
  const user = await currentUser()
  if (!user) redirect('/login')

  const slots = await loadStudentSchedule(user.id)

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
