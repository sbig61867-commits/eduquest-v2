import { currentCtx, serviceScopeFor } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { canManageAccountOf } from '@/lib/staff-auth'
import { studentBlock } from '@/lib/account-scope'
import { checkNameParts, shortStudentName } from '@/lib/person-name'
import { loadStaffTarget } from '@/lib/staff-target'
import { rateLimit } from '@/lib/rate-limit'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAFF = ['university_admin', 'super_admin', 'center_manager']

// PATCH /api/admin/student-name  { userId, nameParts: { first, father, grandfather, family } }
//
// A student registers with their four-part name and can no longer change it
// (users_update pins full_name for students — supabase/student_name_lock_migration.sql),
// so correcting it is the institution's job. Staff cannot READ the middle names
// (only the student can), so a correction is written whole from the
// institution's records. Same shape as toggle-user: the caller (live) and the
// target in one unit, then the write in the caller's institution.
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!STAFF.includes(ctx.role ?? '')) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const rl = await rateLimit(`student-name:${user.id}`, { limit: 120, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  let body: { userId?: unknown; nameParts?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  if (typeof body.userId !== 'string' || !body.userId) {
    return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
  }
  const name = checkNameParts(body.nameParts)
  if (!name.ok) {
    return NextResponse.json({ ...(await apiErr('studentNameInvalid')), fields: name.errors }, { status: 400 })
  }

  if (!UUID.test(body.userId)) return NextResponse.json({ ...(await apiErr('studentNotFound')) }, { status: 404 })
  const loaded = await loadStaffTarget(ctx, body.userId)
  const caller = loaded?.me
  if (!caller || !STAFF.includes(caller.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  // Student management capability, for admins as well as centre managers.
  if (!canManageAccountOf(caller, 'student')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const target = loaded.target
  if (!target || target.role !== 'student') {
    return NextResponse.json({ ...(await apiErr('studentNotFound')) }, { status: 404 })
  }
  if (caller.role !== 'super_admin' && target.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  // A centre manager corrects only centre-only trainees; a university student's
  // record belongs to the institution admin (src/lib/account-scope.ts).
  if (caller.role === 'center_manager') {
    const block = studentBlock(target.is_university_student)
    if (block) return NextResponse.json({ ...(await apiErr(block)), scope: block }, { status: 403 })
  }

  // The four parts go to the student's private row; staff get back only the
  // short name their screens show (src/lib/student-names.ts).
  // One unit: the private row and the short name, written only while the
  // caller is still a live staff member of the student's institution.
  const stored = shortStudentName(name.parts)
  const p = name.parts
  try {
    const [, rows] = await run(serviceScopeFor(ctx)!, sql => [
      sql`insert into public.student_names (user_id, first_name, father_name, grandfather_name, family_name, updated_at)
          select u.id, ${p.first}, ${p.father}, ${p.grandfather}, ${p.family}, now()
            from public.users u, public.users me
           where u.id = ${target.id} and u.role = 'student'
             and me.id = ${user.id} and me.is_active is not false and me.role in ('university_admin', 'super_admin', 'center_manager')
             and (me.role = 'super_admin' or me.tenant_id = u.tenant_id)
          on conflict (user_id) do update set first_name = excluded.first_name, father_name = excluded.father_name,
            grandfather_name = excluded.grandfather_name, family_name = excluded.family_name, updated_at = excluded.updated_at`,
      sql`update public.users u set full_name = ${stored}, name_complete = true
            from public.users me
           where u.id = ${target.id} and u.role = 'student'
             and me.id = ${user.id} and me.is_active is not false and me.role in ('university_admin', 'super_admin', 'center_manager')
             and (me.role = 'super_admin' or me.tenant_id = u.tenant_id)
          returning u.id`,
    ])
    if (!maybeOne(rows)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json({ ok: true, full_name: stored, name_complete: stored === name.shortName })
  } catch (e) {
    console.error('[student-name]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('studentNameUpdateFailed')) }, { status: 500 })
  }
}
