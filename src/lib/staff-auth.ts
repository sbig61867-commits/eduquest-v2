import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { createClient } from '@/lib/supabase/server'
import { getAdminDb } from '@/lib/db'
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
  return getAdminDb()
}

export async function getCaller(): Promise<{ caller: StaffCaller } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions, is_active').eq('id', user.id).single()
  if (!profile?.tenant_id || profile.is_active === false) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
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

/**
 * The one gate for creating / inviting / (de)activating / deleting an account
 * of `targetRole`, for every staff role. A university_admin is bound by the
 * same capability flags as a centre manager (default ON, but the owner may
 * switch them off) — before this, only centre managers were checked, so an
 * owner-restricted admin could keep managing teachers and students.
 *   teacher / student  → manage_teachers / manage_students
 *   center_manager     → a university_admin holding manage_center_staff
 *   university_admin   → the owner only
 * super_admin passes everything; the route still applies its own tenant rules.
 */
export function canManageAccountOf(caller: Pick<StaffCaller, 'role' | 'permissions'>, targetRole: string): boolean {
  if (caller.role === 'super_admin') return true
  if (targetRole === 'center_manager') return caller.role === 'university_admin' && staffCan(caller, 'manage_center_staff')
  return canManageAccountRole(caller, targetRole)
}

/** Confirm a user id is an active-or-not teacher in this tenant. */
export async function isTenantTeacher(admin: ReturnType<typeof serviceClient>, tenantId: string, teacherId: unknown) {
  if (typeof teacherId !== 'string' || !teacherId) return false
  const { data } = await admin
    .from('users').select('id').eq('id', teacherId).eq('tenant_id', tenantId).eq('role', 'teacher').maybeSingle()
  return !!data
}
