import { currentCtx, serviceScopeFor } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { staffCan } from '@/lib/staff-auth'
import { loadStaffTarget } from '@/lib/staff-target'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PATCH /api/admin/teacher-permissions
// Body: { teacher_id, can_create_courses }
// Allowed by: university_admin (own tenant) + super_admin (any tenant)
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!['super_admin', 'university_admin'].includes(ctx.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  let body: { teacher_id?: string; can_create_courses?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { teacher_id, can_create_courses } = body
  if (!teacher_id || typeof can_create_courses !== 'boolean') {
    return NextResponse.json({ ...(await apiErr('teacherAndPermissionRequired')) }, { status: 400 })
  }
  if (!UUID.test(teacher_id)) return NextResponse.json({ ...(await apiErr('teacherNotFound')) }, { status: 404 })

  // The caller (live) and the teacher inside the caller's institution, in one unit.
  const loaded = await loadStaffTarget(ctx, teacher_id)
  const caller = loaded?.me
  if (!caller || !['super_admin', 'university_admin'].includes(caller.role) || !staffCan(caller, 'manage_teachers')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const teacher = loaded.target
  if (!teacher || teacher.role !== 'teacher') {
    return NextResponse.json({ ...(await apiErr('teacherNotFound')) }, { status: 404 })
  }
  if (caller.role === 'university_admin' && teacher.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('teacherNotInTenant')) }, { status: 403 })
  }

  try {
    const [rows] = await run(serviceScopeFor(ctx)!, sql => [
      sql`with me as (
            select role, tenant_id from public.users
             where id = ${ctx.sub} and is_active is not false and role in ('university_admin', 'super_admin')
          )
          update public.users u set can_create_courses = ${can_create_courses}
            from me
           where u.id = ${teacher_id} and u.role = 'teacher' and (me.role = 'super_admin' or u.tenant_id = me.tenant_id)
          returning u.id`,
    ])
    if (!maybeOne(rows)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[teacher-permissions]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('teacherPermissionsFailed')) }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    teacher_id,
    can_create_courses,
    message: `${teacher.full_name} can ${can_create_courses ? 'now' : 'no longer'} create courses`,
  })
}
