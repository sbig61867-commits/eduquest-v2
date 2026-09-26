import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { canManageAccountRole } from '@/lib/staff-auth'
import { loadTeacherFootprint, studentBlock, teacherBlock } from '@/lib/account-scope'

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

  if (!caller || !['university_admin', 'super_admin', 'center_manager'].includes(caller.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { userId?: string; isActive?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { userId, isActive } = body
  if (!userId || typeof isActive !== 'boolean') {
    return NextResponse.json({ ...(await apiErr('missingUserOrActive')) }, { status: 400 })
  }

  // Verify the target user belongs to the caller's tenant (super_admin can update anyone)
  const { data: target } = await supabase
    .from('users').select('id, tenant_id, role, is_university_student').eq('id', userId).single()

  if (!target) return NextResponse.json({ ...(await apiErr('userNotFound')) }, { status: 404 })

  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Prevent disabling a super_admin
  if (target.role === 'super_admin') {
    return NextResponse.json({ ...(await apiErr('cannotEditOwner')) }, { status: 403 })
  }
  // A centre manager may only (de)activate teachers/students, behind the matching flag.
  if (caller.role === 'center_manager' && !canManageAccountRole(caller, target.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  // …and only people who exist purely on the centre side. Teachers and
  // students are shared with the university; switching one of those off
  // would lock them out of the university too, so that stays with the
  // institution admin (src/lib/account-scope.ts).
  if (caller.role === 'center_manager') {
    const block = target.role === 'student'
      ? studentBlock(target.is_university_student)
      : teacherBlock(await loadTeacherFootprint(adminClient(), caller.tenant_id, target.id))
    if (block) return NextResponse.json({ ...(await apiErr(block)), scope: block }, { status: 403 })
  }

  const { error } = await adminClient()
    .from('users').update({ is_active: isActive }).eq('id', userId)

  if (error) {
    console.error('[toggle-user]', error)
    return NextResponse.json({ ...(await apiErr('userStatusFailed')) }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
