import { currentCtx, serviceScopeFor } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { canManageAccountRole } from '@/lib/staff-auth'
import { canSetAffiliation } from '@/lib/student-affiliation'
import { loadStaffTarget } from '@/lib/staff-target'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAFF = ['university_admin', 'super_admin', 'center_manager']

// PATCH /api/admin/student-affiliation  { userId, isUniversityStudent }
//
// Moves a student between the two populations of one tenant (university vs
// continuing-education centre). Needed because every pre-existing account
// defaults to `is_university_student = true`, so centre-only trainees created
// before this feature must be corrected.
//
// Same shape as the other privileged writes: the caller (live), the target and
// the institution's settings in one unit, then the write in the caller's
// institution. Reclassifying is gated by `announce_to_university` — whoever
// may not address university students may not move students into that
// audience either.
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!STAFF.includes(ctx.role ?? '')) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { userId?: string; isUniversityStudent?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { userId, isUniversityStudent } = body
  if (!userId || typeof isUniversityStudent !== 'boolean') {
    return NextResponse.json({ ...(await apiErr('missingUserOrAffiliation')) }, { status: 400 })
  }
  if (!UUID.test(userId)) return NextResponse.json({ ...(await apiErr('studentNotFound')) }, { status: 404 })

  const loaded = await loadStaffTarget(ctx, userId, { settings: true })
  const caller = loaded?.me
  if (!loaded || !caller || !STAFF.includes(caller.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (!canSetAffiliation(caller)) {
    return NextResponse.json({ ...(await apiErr('cannotClassifyStudents')) }, { status: 403 })
  }
  const target = loaded.target
  if (!target || target.role !== 'student') {
    return NextResponse.json({ ...(await apiErr('studentNotFound')) }, { status: 404 })
  }
  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (caller.tenant_id && !loaded.settings?.has_center) {
    return NextResponse.json({ ...(await apiErr('noCentreAllInstitution')) }, { status: 409 })
  }
  // A centre manager must additionally hold the student-management flag.
  if (caller.role === 'center_manager' && !canManageAccountRole(caller, 'student')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  try {
    const [rows] = await run(serviceScopeFor(ctx)!, sql => [
      sql`with me as (
            select role, tenant_id from public.users
             where id = ${ctx.sub} and is_active is not false and role in ('university_admin', 'super_admin', 'center_manager')
          )
          update public.users u set is_university_student = ${isUniversityStudent}
            from me
           where u.id = ${userId} and u.role = 'student' and (me.role = 'super_admin' or u.tenant_id = me.tenant_id)
          returning u.id`,
    ])
    if (!maybeOne(rows)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[student-affiliation]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('affiliationUpdateFailed')) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
