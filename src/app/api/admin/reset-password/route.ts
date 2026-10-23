import { getSessionUser } from '@/lib/auth'
import { authSetPassword } from '@/lib/auth/better'
import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { canManageAccountOf } from '@/lib/staff-auth'
import { loadTeacherFootprintSql, studentBlock, teacherBlock } from '@/lib/account-scope'
import { generateTempPassword } from '@/lib/member-login'
import { rateLimit } from '@/lib/rate-limit'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A teacher re-issues only what they could have handed over themselves
// (owner's decision, 2026-10-21): a student in one of their own groups who
// still has a temporary password (must_change_password), i.e. has never chosen
// their own. That covers "I created the account and lost the details" without
// letting a teacher take over an account its student already uses.
async function teacherRefusal(tenantId: string, teacherId: string, studentId: string): Promise<ApiErrorCode | null> {
  // one unit, as app_service pinned to the teacher's institution
  const [rows] = await run({ as: 'service', tenantId }, sql => [sql`
    select exists (
             select 1 from public.group_students gs
               join public.groups g on g.id = gs.group_id
              where g.teacher_id = ${teacherId} and g.deleted_at is null and gs.student_id = ${studentId}
           ) as linked,
           (select must_change_password from public.users where id = ${studentId}) as must_change`])
  const r = maybeOne<{ linked: boolean; must_change: boolean | null }>(rows)
  if (!r?.linked) return 'forbidden'
  if (r.must_change !== true) return 'studentPasswordAlreadySet'
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
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' && UUID.test(body.userId) ? body.userId : ''

  // Both profiles in one unit, read as the caller: RLS decides what they may see.
  type Caller = { role: string; tenant_id: string | null; permissions: Record<string, unknown> | null }
  type Target = { id: string; tenant_id: string | null; role: string; is_university_student: boolean | null }
  const [callerRows, targetRows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select role, tenant_id, permissions from public.users where id = ${user.id}`,
    sql`select id, tenant_id, role, is_university_student from public.users where id = ${userId || null}`,
  ])
  const caller = maybeOne<Caller>(callerRows)
  const target = maybeOne<Target>(targetRows)
  if (!caller || !['university_admin', 'super_admin', 'center_manager', 'teacher'].includes(caller.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const rl = await rateLimit(`reset-password:${user.id}`, { limit: 20, windowSecs: 3600 })
  if (!rl.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  if (!userId) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  // Your own password changes in Settings, with your current one.
  if (userId === user.id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  if (!target) return NextResponse.json({ ...(await apiErr('userNotFound')) }, { status: 404 })
  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (target.role === 'super_admin') return NextResponse.json({ ...(await apiErr('cannotEditOwner')) }, { status: 403 })
  if (caller.role === 'teacher') {
    const refusal = target.role === 'student' && caller.tenant_id ? await teacherRefusal(caller.tenant_id, user.id, target.id) : 'forbidden'
    if (refusal) return NextResponse.json({ ...(await apiErr(refusal)) }, { status: 403 })
  } else if (!canManageAccountOf(caller, target.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } else if (caller.role === 'center_manager') {
    const block = target.role === 'student'
      ? studentBlock(target.is_university_student)
      : teacherBlock(await loadTeacherFootprintSql(caller.tenant_id as string, target.id))
    if (block) return NextResponse.json({ ...(await apiErr(block)), scope: block }, { status: 403 })
  }

  // the flag is written as app_service on the account's institution (or, for
  // an owner acting on an account without one, in platform scope)
  const scope = target.tenant_id ? { as: 'service' as const, tenantId: target.tenant_id }
    : caller.role === 'super_admin' ? { as: 'service' as const, platform: true as const } : null
  if (!scope) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const password = generateTempPassword()
  const { error } = await authSetPassword(target.id, password)
  if (error) {
    console.error('[reset-password]', error.message)
    return NextResponse.json({ ...(await apiErr('passwordChangeFailed')) }, { status: 500 })
  }
  await run(scope, sql => [sql`update public.users set must_change_password = true where id = ${target.id}`])
  return NextResponse.json({ password })
}
