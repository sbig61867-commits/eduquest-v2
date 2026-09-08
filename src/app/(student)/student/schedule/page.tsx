export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ScheduleGrid } from '@/components/schedules/schedule-grid'
import { loadStudentSchedule } from '@/lib/schedules-data'
import { PageTitle } from '@/components/shared/page-title'

export default async function StudentSchedulePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const slots = await loadStudentSchedule(supabase)

  return (
    <>
      <PageTitle title="Schedule" />

      <div className="max-w-4xl mx-auto" dir="rtl">
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-fg">جدول مواعيدي</h1>
          <p className="text-[13px] text-fg-muted mt-1.5">المواعيد الأسبوعية للمجموعات المسجَّل بها</p>
        </div>
        <ScheduleGrid slots={slots} showGroup emptyText="لم يُنشر جدول مواعيد لمجموعاتك بعد." />
      </div>
    </>
  )
}
