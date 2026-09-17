export const dynamic = 'force-dynamic'

import { loadCenterAccess } from '@/lib/center-access'
import { NoPermission } from '@/components/center/no-permission'
import { AttendanceClient } from '@/components/center/attendance-client'

export default async function CenterAttendancePage() {
  const { supabase, tenantId, has } = await loadCenterAccess()
  if (!has('manage_attendance')) return <NoPermission label="تسجيل الحضور" />

  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name')

  return <AttendanceClient groups={(groups ?? []).map(g => ({ id: g.id as string, name: g.name as string }))} />
}
