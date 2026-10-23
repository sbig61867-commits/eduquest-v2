import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { canManageAccountOf } from '@/lib/staff-auth'
import { studentBlock, teacherBlock } from '@/lib/account-scope'
import { isSeatRole, seatRoleFromDbError, SEAT_LIMIT_CODE } from '@/lib/seat-limit'
import { loadStaffTarget } from '@/lib/staff-target'
import { serviceScopeFor } from '@/lib/auth/current'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAFF = ['university_admin', 'super_admin', 'center_manager']

export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (!STAFF.includes(ctx.role ?? '')) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  let body: { userId?: string; isActive?: boolean }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { userId, isActive } = body
  if (!userId || typeof isActive !== 'boolean') {
    return NextResponse.json({ ...(await apiErr('missingUserOrActive')) }, { status: 400 })
  }
  if (!UUID.test(userId)) return NextResponse.json({ ...(await apiErr('userNotFound')) }, { status: 404 })

  // One unit: the caller (live), the target inside the caller's institution,
  // the target's teaching footprint and the institution's seat usage.
  const loaded = await loadStaffTarget(ctx, userId, { footprint: ctx.role === 'center_manager', seats: isActive })
  const caller = loaded?.me
  if (!loaded || !caller || !STAFF.includes(caller.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const target = loaded.target
  if (!target) return NextResponse.json({ ...(await apiErr('userNotFound')) }, { status: 404 })

  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Prevent disabling a super_admin
  if (target.role === 'super_admin') {
    return NextResponse.json({ ...(await apiErr('cannotEditOwner')) }, { status: 403 })
  }
  // Behind the matching capability flag, for admins as well as centre managers.
  if (!canManageAccountOf(caller, target.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  // …and only people who exist purely on the centre side. Teachers and
  // students are shared with the university; switching one of those off
  // would lock them out of the university too, so that stays with the
  // institution admin (src/lib/account-scope.ts).
  if (caller.role === 'center_manager') {
    const block = target.role === 'student' ? studentBlock(target.is_university_student) : teacherBlock(loaded.footprint)
    if (block) return NextResponse.json({ ...(await apiErr(block)), scope: block }, { status: 403 })
  }

  // Re-enabling a student/teacher takes a plan seat back: refused while the
  // institution is at its limit (the DB trigger enforces the same rule).
  if (isActive && target.is_active === false && target.tenant_id && isSeatRole(target.role)) {
    const seat = loaded.seats?.[target.role]
    if (seat && !seat.allowed) {
      return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[target.role])), limit: seat.limit }, { status: 403 })
    }
  }

  // The write repeats the checks that do not need the capability rules: the
  // caller is still a live staff member of the target's institution (or the
  // owner) and the target is not the owner.
  try {
    const [rows] = await run(serviceScopeFor(ctx)!, sql => [
      sql`with me as (
            select role, tenant_id from public.users
             where id = ${ctx.sub} and is_active is not false and role in ('university_admin', 'super_admin', 'center_manager')
          )
          update public.users u set is_active = ${isActive}
            from me
           where u.id = ${userId} and u.role <> 'super_admin'
             and (me.role = 'super_admin' or u.tenant_id = me.tenant_id)
          returning u.id`,
    ])
    if (!maybeOne(rows)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    const full = seatRoleFromDbError(e instanceof Error ? e.message : null)
    if (full) return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[full])) }, { status: 403 })
    console.error('[toggle-user]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('userStatusFailed')) }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
