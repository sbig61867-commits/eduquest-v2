import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { can, type Capability } from '@/lib/permissions'

// Shared caller resolution for staff route handlers. Identity and capability
// are read through the USER session (RLS-scoped); the service-role client is
// handed back only for the privileged write that follows the check.

export interface StaffCaller {
  id: string
  role: string
  tenant_id: string
  permissions: Record<string, unknown> | null
}

export function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function getCaller(): Promise<{ caller: StaffCaller } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'غير مصرّح' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions, is_active').eq('id', user.id).single()
  if (!profile?.tenant_id || profile.is_active === false) {
    return { error: NextResponse.json({ error: 'ممنوع' }, { status: 403 }) }
  }
  return { caller: { id: user.id, role: profile.role, tenant_id: profile.tenant_id, permissions: profile.permissions } }
}

/** Staff capability check (role defaults resolved in permissions.ts; teachers/students never pass). */
export function staffCan(caller: Pick<StaffCaller, 'role' | 'permissions'>, cap: Capability): boolean {
  return can(caller.role, caller.permissions, cap)
}

/**
 * May this staff caller create / invite / (de)activate an account of `targetRole`?
 * A centre manager is capped at teacher + student, each behind its own flag —
 * never another manager or admin.
 */
export function canManageAccountRole(caller: Pick<StaffCaller, 'role' | 'permissions'>, targetRole: string): boolean {
  if (targetRole === 'teacher') return staffCan(caller, 'manage_teachers')
  if (targetRole === 'student') return staffCan(caller, 'manage_students')
  return false
}

/** Confirm a user id is an active-or-not teacher in this tenant. */
export async function isTenantTeacher(admin: ReturnType<typeof serviceClient>, tenantId: string, teacherId: unknown) {
  if (typeof teacherId !== 'string' || !teacherId) return false
  const { data } = await admin
    .from('users').select('id').eq('id', teacherId).eq('tenant_id', tenantId).eq('role', 'teacher').maybeSingle()
  return !!data
}
