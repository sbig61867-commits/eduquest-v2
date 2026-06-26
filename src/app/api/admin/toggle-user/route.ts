import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

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
    .from('users').select('role, tenant_id').eq('id', user.id).single()

  if (!caller || !['university_admin', 'super_admin'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { userId?: string; isActive?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { userId, isActive } = body
  if (!userId || typeof isActive !== 'boolean') {
    return NextResponse.json({ error: 'Missing userId or isActive' }, { status: 400 })
  }

  // Verify the target user belongs to the caller's tenant (super_admin can update anyone)
  const { data: target } = await supabase
    .from('users').select('id, tenant_id, role').eq('id', userId).single()

  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Prevent disabling a super_admin
  if (target.role === 'super_admin') {
    return NextResponse.json({ error: 'Cannot modify a super admin account' }, { status: 403 })
  }

  const { error } = await adminClient()
    .from('users').update({ is_active: isActive }).eq('id', userId)

  if (error) {
    console.error('[toggle-user]', error)
    return NextResponse.json({ error: 'Failed to update user status' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
