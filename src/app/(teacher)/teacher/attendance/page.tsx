export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AttendanceClient } from '@/components/center/attendance-client'
import { ScopedIntlProvider } from '@/i18n/provider'

// The teacher marks attendance for their OWN groups only. /api/attendance
// already authorizes the group's teacher (owner) exactly like staff holding
// manage_attendance, so this page just feeds it the right group list.
// The tenant_id/teacher_id filters mirror RLS as defense-in-depth.
export default async function TeacherAttendancePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tenant_id', user.tenant_id)
    .eq('teacher_id', user.id)
    .eq('is_active', true)
    .order('name')

  return (
    <ScopedIntlProvider namespaces={['common', 'teacher', 'terms', 'staff']}>
      <AttendanceClient groups={(groups ?? []).map(g => ({ id: g.id as string, name: g.name as string }))} />
    </ScopedIntlProvider>
  )
}
