import { NextResponse } from 'next/server'
import { getCaller, staffCan, type StaffCaller } from '@/lib/staff-auth'

// Who may link a mailbox and email students from it: university admins and
// centre managers who manage students. Teachers/students never.
export async function getMailCaller(): Promise<{ caller: StaffCaller } | { error: NextResponse }> {
  const res = await getCaller()
  if ('error' in res) return res
  const { caller } = res
  if (!['university_admin', 'center_manager'].includes(caller.role) || !staffCan(caller, 'manage_students')) {
    return { error: NextResponse.json({ error: 'لا تملك صلاحية مراسلة الطلاب' }, { status: 403 }) }
  }
  return { caller }
}
