import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  canEditPermissionsOf, ungrantableCapabilities, sanitizePermissions, CAPABILITY_LABELS,
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { user_id?: string; permissions?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const targetId = body.user_id
  if (!targetId) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })
  if (targetId === user.id) {
    return NextResponse.json({ error: 'لا يمكنك تعديل صلاحيات نفسك' }, { status: 400 })
  }

  const admin = adminClient()
  const { data: target } = await admin
    .from('users').select('id, role, tenant_id').eq('id', targetId).single()
  if (!target) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })

  // A university_admin may only touch users inside their own tenant.
  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!canEditPermissionsOf(caller.role, target.role)) {
    return NextResponse.json({ error: 'لا يمكنك تعديل صلاحيات هذا الدور' }, { status: 403 })
  }

  const requested = sanitizePermissions(body.permissions)
  const blocked = ungrantableCapabilities(caller.role, caller.permissions, requested)
  if (blocked.length > 0) {
    return NextResponse.json(
      { error: `لا يمكنك منح صلاحية لا تملكها: ${blocked.map(b => CAPABILITY_LABELS[b]).join('، ')}` },
      { status: 403 },
    )
  }

  const { error } = await admin.from('users').update({ permissions: requested }).eq('id', targetId)
  if (error) {
    console.error('[api/admin/permissions PATCH]', error)
    return NextResponse.json({ error: 'تعذّر حفظ الصلاحيات' }, { status: 500 })
  }
  return NextResponse.json({ success: true, permissions: requested })
}
