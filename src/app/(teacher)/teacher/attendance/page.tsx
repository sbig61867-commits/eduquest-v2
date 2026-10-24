export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { AttendanceClient } from '@/components/center/attendance-client'
import { ScopedIntlProvider } from '@/i18n/provider'

// The teacher marks attendance for their OWN groups only. /api/attendance
// already authorizes the group's teacher (owner) exactly like staff holding
// manage_attendance, so this page just feeds it the right group list.
// The tenant_id/teacher_id filters mirror RLS as defense-in-depth.
export default async function TeacherAttendancePage() {
  const user = await currentUser()
  if (!user?.tenant_id) redirect('/login')
  const tenantId = user.tenant_id

  const [groups] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select id, name from public.groups
         where tenant_id = ${tenantId} and teacher_id = ${user.id} and is_active order by name limit 500`,
  ])

  return (
    <ScopedIntlProvider namespaces={['common', 'teacher', 'terms', 'staff']}>
      <AttendanceClient groups={groups.map(g => ({ id: g.id as string, name: g.name as string }))} />
    </ScopedIntlProvider>
  )
}
