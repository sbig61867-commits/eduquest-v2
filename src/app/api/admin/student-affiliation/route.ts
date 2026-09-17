import { NextResponse } from 'next/server'
import { getTenantSettings } from '@/lib/structure-mode'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { canManageAccountRole } from '@/lib/staff-auth'
import { canSetAffiliation } from '@/lib/student-affiliation'

// PATCH /api/admin/student-affiliation  { userId, isUniversityStudent }
//
// Moves a student between the two populations of one tenant (university vs
// continuing-education centre). Needed because every pre-existing account
// defaults to `is_university_student = true`, so centre-only trainees created
// before this feature must be corrected.
//
// Same shape as the other privileged writes: authorize with the USER session,
// verify the target is a student in the caller's tenant, then write with the
// service-role client. Reclassifying is gated by `announce_to_university` —
// whoever may not address university students may not move students into that
// audience either.
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

  if (!caller || !['university_admin', 'super_admin', 'center_manager'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!canSetAffiliation(caller)) {
    return NextResponse.json(
      { error: 'لا تملك صلاحية تصنيف الطلاب — تحتاج صلاحية «مخاطبة طلاب المؤسسة»' },
      { status: 403 },
    )
  }
  if (caller.tenant_id && !(await getTenantSettings(supabase, caller.tenant_id)).has_center) {
    return NextResponse.json({ error: 'لا يوجد مركز تعليم مستمر في مؤسستك — كل الطلاب من طلابها' }, { status: 409 })
  }
  // A centre manager must additionally hold the student-management flag.
  if (caller.role === 'center_manager' && !canManageAccountRole(caller, 'student')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { userId?: string; isUniversityStudent?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { userId, isUniversityStudent } = body
  if (!userId || typeof isUniversityStudent !== 'boolean') {
    return NextResponse.json({ error: 'Missing userId or isUniversityStudent' }, { status: 400 })
  }

  const { data: target } = await supabase
    .from('users').select('id, tenant_id, role').eq('id', userId).single()

  if (!target || target.role !== 'student') {
    return NextResponse.json({ error: 'الطالب غير موجود' }, { status: 404 })
  }
  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminClient()
    .from('users').update({ is_university_student: isUniversityStudent }).eq('id', userId)

  if (error) {
    console.error('[student-affiliation]', error)
    return NextResponse.json({ error: 'تعذّر تحديث تصنيف الطالب' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
