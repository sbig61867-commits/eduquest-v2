import { currentCtx } from '@/lib/auth/current'
import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { run, maybeOne } from '@/lib/db/sql'
import { can, type Capability } from '@/lib/permissions'

// Shared caller resolution for staff route handlers. Identity and capability
// are read from the live row (scoped to the session's institution); the service client is
// handed back only for the privileged write that follows the check.

export interface StaffCaller {
  id: string
  role: string
  tenant_id: string
  permissions: Record<string, unknown> | null
  /** The institution's structure ('flat' | 'academic'), read with the caller. */
  structure_mode?: string | null
}

/**
 * The staff caller from their LIVE row (role, capabilities, active), read as
 * app_service pinned to the session's institution — an account moved to
 * another institution is not visible there and is refused.
 */
export async function getCaller(): Promise<{ caller: StaffCaller } | { error: NextResponse }> {
  const ctx = await currentCtx()
  if (!ctx) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }
  const forbidden = async () => ({ error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) })
  if (!ctx.tenant_id) return forbidden()
  const tenantId = ctx.tenant_id

  const [rows] = await run({ as: 'service', tenantId }, sql => [
    sql`select u.role, u.tenant_id, u.permissions, t.structure_mode
          from public.users u join public.tenants t on t.id = u.tenant_id
         where u.id = ${ctx.sub} and u.tenant_id = ${tenantId} and u.is_active is not false`,
  ])
  const profile = maybeOne<{ role: string; tenant_id: string; permissions: Record<string, unknown> | null; structure_mode: string | null }>(rows)
  if (!profile) return forbidden()
  return { caller: { id: ctx.sub, role: profile.role, tenant_id: profile.tenant_id, permissions: profile.permissions, structure_mode: profile.structure_mode } }
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

