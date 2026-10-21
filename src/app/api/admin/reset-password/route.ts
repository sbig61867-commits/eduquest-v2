import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { canManageAccountOf } from '@/lib/staff-auth'
import { loadTeacherFootprint, studentBlock, teacherBlock } from '@/lib/account-scope'
import { generateTempPassword } from '@/lib/member-login'
import { rateLimit } from '@/lib/rate-limit'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// A teacher re-issues only what they could have handed over themselves
// (owner's decision, 2026-10-21): a student in one of their own groups who
// still has a temporary password (must_change_password), i.e. has never chosen
// their own. That covers "I created the account and lost the details" without
// letting a teacher take over an account its student already uses.
async function teacherRefusal(admin: ReturnType<typeof adminClient>, teacherId: string, studentId: string): Promise<ApiErrorCode | null> {
  const { data: groups } = await admin
    .from('groups').select('id').eq('teacher_id', teacherId).is('deleted_at', null).limit(500)
  const groupIds = (groups ?? []).map(g => g.id as string)
  if (groupIds.length === 0) return 'forbidden'
  const { data: link } = await admin
    .from('group_students').select('group_id').eq('student_id', studentId).in('group_id', groupIds).limit(1).maybeSingle()
  if (!link) return 'forbidden'
  const { data } = await admin.auth.admin.getUserById(studentId)
  if (data?.user?.app_metadata?.must_change_password !== true) return 'studentPasswordAlreadySet'
  return null
}

// Staff reset a member's forgotten password (2026-10-17). Accounts created by
// member ID have no email, so "forgot password" cannot reach them; this is
// their only way back. The platform issues a temporary password (shown once
// to the staff member, never stored) and sets must_change_password, so the
// member has to choose their own at the next sign-in.
//
// Who may reset whom is exactly who may switch an account on or off
// (/api/admin/toggle-user): same tenant, the matching capability, and a
// centre manager only for people who exist purely on the centre side.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: caller } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!caller || !['university_admin', 'super_admin', 'center_manager', 'teacher'].includes(caller.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const rl = await rateLimit(`reset-password:${user.id}`, { limit: 20, windowSecs: 3600 })
  if (!rl.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  const body = await request.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId : ''
  if (!userId) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  // Your own password changes in Settings, with your current one.
  if (userId === user.id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const { data: target } = await supabase
    .from('users').select('id, tenant_id, role, is_university_student').eq('id', userId).single()
  if (!target) return NextResponse.json({ ...(await apiErr('userNotFound')) }, { status: 404 })
  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (target.role === 'super_admin') return NextResponse.json({ ...(await apiErr('cannotEditOwner')) }, { status: 403 })
  if (caller.role === 'teacher') {
    const refusal = target.role === 'student' ? await teacherRefusal(adminClient(), user.id, target.id) : 'forbidden'
    if (refusal) return NextResponse.json({ ...(await apiErr(refusal)) }, { status: 403 })
  } else if (!canManageAccountOf(caller, target.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } else if (caller.role === 'center_manager') {
    const block = target.role === 'student'
      ? studentBlock(target.is_university_student)
      : teacherBlock(await loadTeacherFootprint(adminClient(), caller.tenant_id, target.id))
    if (block) return NextResponse.json({ ...(await apiErr(block)), scope: block }, { status: 403 })
  }

  const password = generateTempPassword()
  const { error } = await adminClient().auth.admin.updateUserById(target.id, {
    password,
    app_metadata: { must_change_password: true },
  })
  if (error) {
    console.error('[reset-password]', error.message)
    return NextResponse.json({ ...(await apiErr('passwordChangeFailed')) }, { status: 500 })
  }
  return NextResponse.json({ password })
}
