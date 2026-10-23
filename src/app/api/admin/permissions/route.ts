import { currentCtx, serviceScopeFor } from '@/lib/auth/current'
import { getTranslations } from 'next-intl/server'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { loadStaffTarget } from '@/lib/staff-target'
import {
  canEditPermissionsOf, ungrantableCapabilities, sanitizePermissions,
} from '@/lib/permissions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Sets another staff member's capability flags.
//   super_admin      → may configure a university_admin (and a center_manager)
//   university_admin → may configure a center_manager in their own tenant
// Escalation guard: nobody can grant a capability they do not themselves hold.
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  let body: { user_id?: string; permissions?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const targetId = body.user_id
  if (!targetId) return NextResponse.json({ ...(await apiErr('missingUserId')) }, { status: 400 })
  if (targetId === ctx.sub) {
    return NextResponse.json({ ...(await apiErr('cannotEditOwnPermissions')) }, { status: 400 })
  }
  if (!UUID.test(targetId)) return NextResponse.json({ ...(await apiErr('userNotFound')) }, { status: 404 })

  // The caller (live: role and the capabilities they may grant) and the target
  // inside the caller's institution, in one unit.
  const loaded = await loadStaffTarget(ctx, targetId)
  const caller = loaded?.me
  if (!caller) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const target = loaded.target
  if (!target) return NextResponse.json({ ...(await apiErr('userNotFound')) }, { status: 404 })

  // A university_admin may only touch users inside their own tenant.
  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (!canEditPermissionsOf(caller.role, target.role)) {
    return NextResponse.json({ ...(await apiErr('cannotEditRolePermissions')) }, { status: 403 })
  }

  const requested = sanitizePermissions(body.permissions)
  const blocked = ungrantableCapabilities(caller.role, caller.permissions, requested)
  if (blocked.length > 0) {
    return NextResponse.json(
      { ...(await apiErr('cannotGrant', { capabilities: await capabilityList(blocked) })) },
      { status: 403 },
    )
  }

  // The write is bound to what was checked: the target still has the role the
  // rules were applied to, and the caller is still live in the same institution.
  try {
    const [rows] = await run(serviceScopeFor(ctx)!, sql => [
      sql`with me as (
            select role, tenant_id from public.users where id = ${ctx.sub} and is_active is not false and role = ${caller.role}
          )
          update public.users u set permissions = ${sql.json(requested as Parameters<typeof sql.json>[0])}
            from me
           where u.id = ${targetId} and u.role = ${target.role} and (me.role = 'super_admin' or u.tenant_id = me.tenant_id)
          returning u.id`,
    ])
    if (!maybeOne(rows)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[api/admin/permissions PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('permissionsSaveFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true, permissions: requested })
}

/** Localized, comma-joined capability names for the "cannot grant" message. */
async function capabilityList(caps: readonly string[]): Promise<string> {
  const t = await getTranslations('staff')
  const sep = t('capabilities.separator')
  return caps.map(c => t(`capabilities.${c}.label`)).join(sep)
}
