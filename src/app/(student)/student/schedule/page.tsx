export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ScheduleGrid } from '@/components/schedules/schedule-grid'
import { loadStudentSchedule } from '@/lib/schedules-data'

// Students have no direct row read on schedules — get_student_schedule()
// returns only published timetables for the groups they are enrolled in.
export default async function StudentSchedulePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const slots = await loadStudentSchedule(supabase)

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold text-fg">جدول مواعيدي</h2>
        <p className="text-fg-secondary mt-1">المواعيد الأسبوعية للمجموعات المسجَّل بها</p>
      </div>
      <ScheduleGrid slots={slots} showGroup emptyText="لم يُنشر جدول مواعيد لمجموعاتك بعد." />
    </div>
  )
}
