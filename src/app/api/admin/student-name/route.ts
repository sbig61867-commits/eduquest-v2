import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canManageAccountOf, serviceClient } from '@/lib/staff-auth'
import { studentBlock } from '@/lib/account-scope'
import { checkNameParts } from '@/lib/person-name'
import { saveStudentName } from '@/lib/student-names'
import { rateLimit } from '@/lib/rate-limit'

// PATCH /api/admin/student-name  { userId, nameParts: { first, father, grandfather, family } }
//
// A student registers with their four-part name and can no longer change it
// (users_update pins full_name for students — supabase/student_name_lock_migration.sql),
// so correcting it is the institution's job. Staff cannot READ the middle names
// (only the student can), so a correction is written whole from the
// institution's records. Same shape as toggle-user: authorize with the USER
// session, verify the target is a student of the caller's tenant that the caller
// may manage, then write with the service-role client.
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: caller } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()

  if (!caller || !['university_admin', 'super_admin', 'center_manager'].includes(caller.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  // Student management capability, for admins as well as centre managers.
  if (!canManageAccountOf(caller, 'student')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

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

  const { data: target } = await supabase
    .from('users').select('id, tenant_id, role, is_university_student').eq('id', body.userId).single()

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
  try {
    const stored = await saveStudentName(serviceClient(), target.id, name.parts)
    return NextResponse.json({ ok: true, full_name: stored, name_complete: stored === name.shortName })
  } catch (e) {
    console.error('[student-name]', e)
    return NextResponse.json({ ...(await apiErr('studentNameUpdateFailed')) }, { status: 500 })
  }
}
