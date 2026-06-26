import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user: caller } } = await supabase.auth.getUser()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('users').select('role, tenant_id').eq('id', caller.id).single()

  if (!callerProfile || !['university_admin', 'super_admin'].includes(callerProfile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Fetch target user to verify ownership and privilege ceiling
  const { data: targetProfile } = await supabase
    .from('users').select('role, tenant_id').eq('id', id).single()

  if (!targetProfile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // university_admin can only delete users within their own tenant
  if (callerProfile.role === 'university_admin' && targetProfile.tenant_id !== callerProfile.tenant_id) {
    return NextResponse.json({ error: 'Cannot delete users from other tenants' }, { status: 403 })
  }

  // Cannot delete a user with equal or higher privilege
  const ROLE_RANK: Record<string, number> = { student: 0, teacher: 1, university_admin: 2, super_admin: 3 }
  if ((ROLE_RANK[targetProfile.role] ?? 0) >= (ROLE_RANK[callerProfile.role] ?? 0)) {
    return NextResponse.json({ error: 'Cannot delete a user with equal or higher privilege' }, { status: 403 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
