import { getTranslations } from 'next-intl/server'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  canEditPermissionsOf, ungrantableCapabilities, sanitizePermissions, 
} from '@/lib/permissions'

// Sets another staff member's capability flags.
//   super_admin      → may configure a university_admin (and a center_manager)
//   university_admin → may configure a center_manager in their own tenant
// Escalation guard: nobody can grant a capability they do not themselves hold.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: caller } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!caller) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { user_id?: string; permissions?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const targetId = body.user_id
  if (!targetId) return NextResponse.json({ ...(await apiErr('missingUserId')) }, { status: 400 })
  if (targetId === user.id) {
    return NextResponse.json({ ...(await apiErr('cannotEditOwnPermissions')) }, { status: 400 })
  }

  const admin = adminClient()
  const { data: target } = await admin
    .from('users').select('id, role, tenant_id').eq('id', targetId).single()
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

  const { error } = await admin.from('users').update({ permissions: requested }).eq('id', targetId)
  if (error) {
    console.error('[api/admin/permissions PATCH]', error)
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
