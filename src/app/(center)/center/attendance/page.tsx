export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { run } from '@/lib/db/sql'
import { NoPermission } from '@/components/shared/no-permission'
import { AttendanceClient } from '@/components/center/attendance-client'

export default async function CenterAttendancePage() {
  const { userId, tenantId, has } = await loadCenterAccess()
  if (!has('manage_attendance')) return <NoPermission capability="manage_attendance" />

  const [groups] = await run({ as: 'user', userId }, sql => [
    sql`select id, name from public.groups where tenant_id = ${tenantId} and is_active order by name limit 1000`,
  ])

  return <AttendanceClient groups={groups as unknown as { id: string; name: string }[]} />
}
