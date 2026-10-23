import { getSessionUser } from '@/lib/auth'
import { authCreateUser, authRemoveUser } from '@/lib/auth/better'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'
import { isSeatRole, seatRoleFromDbError, seatStatus, SEAT_LIMIT_CODE } from '@/lib/seat-limit'
import { canManageAccountOf } from '@/lib/staff-auth'
import { resolveStudentAffiliation } from '@/lib/student-affiliation'
import { checkNameParts, shortStudentName, type NameParts } from '@/lib/person-name'
import { generateTempPassword, placeholderEmail } from '@/lib/member-login'
import { randomUUID } from 'crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// What the screens show for a new account (no password material, no settings).
type CreatedUser = Row & { id: string; email: string; member_code: string | null }

export async function POST(request: Request) {
  try {
    const caller = await getSessionUser()
    if (!caller) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

    const [callerRows] = await run({ as: 'user', userId: caller.id }, sql => [
      sql`select role, tenant_id, permissions from public.users where id = ${caller.id}`,
    ])
    const callerProfile = maybeOne<{ role: string; tenant_id: string | null; permissions: Record<string, unknown> | null }>(callerRows)

    // A teacher may create student accounts too, but only into their own
    // groups (the same reach as their invitation links) — checked below.
    if (!callerProfile || !['university_admin', 'super_admin', 'center_manager', 'teacher'].includes(callerProfile.role)) {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
    const isTeacher = callerProfile.role === 'teacher'

    // 20 user creations per caller per hour
    const rl = await rateLimit(`create-user:${caller.id}`, { limit: 20, windowSecs: 3600 })
    if (!rl.allowed) {
      return NextResponse.json(
        { ...(await apiErr('rateLimited')) },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      )
    }

    const body = await request.json()
    const { role } = body
    // 'member_id': a student or teacher account without an email — the
    // platform issues a member ID and a temporary password for staff to hand
    // over. Every other account is created with the email and password staff typed.
    const byMemberId = body.login_mode === 'member_id'
    if (byMemberId && role !== 'student' && role !== 'teacher') {
      return NextResponse.json({ ...(await apiErr('memberIdStudentsOnly')) }, { status: 400 })
    }
    const email: string = byMemberId ? placeholderEmail(randomUUID()) : (typeof body.email === 'string' ? body.email : '')
    const password: string = byMemberId ? generateTempPassword() : (typeof body.password === 'string' ? body.password : '')

    if (!email?.trim() || !password || !role) {
      return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
    }
    // A student gets their real four-part name (src/lib/person-name.ts), kept
    // private to them; their profile row carries first + family name only
    // (src/lib/student-names.ts). Other roles keep the single full-name field.
    let full_name: string
    let studentParts: NameParts | null = null
    if (role === 'student') {
      const name = checkNameParts(body.name_parts)
      if (!name.ok) {
        return NextResponse.json({ ...(await apiErr('studentNameInvalid')), fields: name.errors }, { status: 400 })
      }
      full_name = name.shortName
      studentParts = name.parts
    } else {
      full_name = typeof body.full_name === 'string' ? body.full_name.trim() : ''
      if (!full_name) return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ...(await apiErr('invalidEmail')) }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ ...(await apiErr('passwordTooShort')) }, { status: 400 })
    }

    const ALLOWED: Record<string, string[]> = {
      super_admin: ['university_admin', 'teacher', 'student'],
      university_admin: ['teacher', 'student'],
      center_manager: ['teacher', 'student'],
      teacher: ['student'],
    }
    if (!ALLOWED[callerProfile.role]?.includes(role)) {
      return NextResponse.json({ error: `Your role cannot create a ${role} account` }, { status: 403 })
    }
    // Every staff role additionally needs the matching per-user capability; a
    // teacher holds none and is bounded by their own groups instead.
    if (!isTeacher && !canManageAccountOf(callerProfile, role)) {
      return NextResponse.json({ ...(await apiErr('cannotCreateRole')) }, { status: 403 })
    }
    const groupId = typeof body.group_id === 'string' && UUID.test(body.group_id) ? body.group_id : null
    if (groupId && role !== 'student') {
      return NextResponse.json({ ...(await apiErr('groupOnlyForStudents')) }, { status: 400 })
    }
    if (isTeacher && !groupId) {
      return NextResponse.json({ ...(await apiErr('teacherGroupRequired')) }, { status: 400 })
    }

    const tenant_id: string | null = callerProfile.role === 'super_admin'
      ? (typeof body.tenant_id === 'string' ? body.tenant_id : null)
      : callerProfile.tenant_id

    if (!tenant_id || !UUID.test(tenant_id)) {
      return NextResponse.json({ ...(await apiErr('tenantRequiredForRole')) }, { status: 400 })
    }
    // Everything from here is done as app_service pinned to that institution.
    const service = { as: 'service', tenantId: tenant_id } as const

    // The institution (never mint an active account inside a suspended one), its
    // seat use for this role and, for a group, the group as the caller sees it
    // (RLS: a teacher only their own) and how full it is. Two units, in parallel.
    const [[tenantRows, seatRows, roomRows], [groupRows]] = await Promise.all([
      run(service, sql => [
        sql`select is_active, has_center, student_limit, teacher_limit from public.tenants where id = ${tenant_id}`,
        sql`select count(*)::int as n from public.users where tenant_id = ${tenant_id} and role = ${role} and is_active`,
        sql`select count(*)::int as n from public.group_students where group_id = ${groupId}`,
      ]),
      run({ as: 'user', userId: caller.id }, sql => [
        sql`select id, tenant_id, teacher_id, max_students, course_id from public.groups where id = ${groupId}`,
      ]),
    ])
    const tenant = maybeOne<{ is_active: boolean; has_center: boolean | null; student_limit: number | null; teacher_limit: number | null }>(tenantRows)
    if (!tenant) return NextResponse.json({ ...(await apiErr('tenantNotFound')) }, { status: 404 })
    if (!tenant.is_active) return NextResponse.json({ ...(await apiErr('tenantSuspended')) }, { status: 403 })
    const hasCenter = tenant.has_center === true

    // Plan seat cap (students / teachers) — checked before the account exists,
    // so a refused request leaves nothing to roll back. The DB trigger
    // users_enforce_seat_limit re-checks it race-free when the profile is written.
    if (isSeatRole(role)) {
      const seat = seatStatus(role === 'student' ? tenant.student_limit : tenant.teacher_limit, maybeOne<{ n: number }>(seatRows)?.n ?? null)
      if (!seat.allowed) {
        return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[role])), limit: seat.limit }, { status: 403 })
      }
    }

    // The group the new student joins (optional for staff, required for a
    // teacher): same rules as an invitation into a group — in this tenant, the
    // teacher's own, and not at its seat cap.
    type Group = { id: string; tenant_id: string; teacher_id: string; max_students: number | null; course_id: string | null }
    const group = groupId ? maybeOne<Group>(groupRows) : null
    if (groupId) {
      if (!group || group.tenant_id !== tenant_id) {
        return NextResponse.json({ ...(await apiErr('groupNotInTenant')) }, { status: 400 })
      }
      if (isTeacher && group.teacher_id !== caller.id) {
        return NextResponse.json({ ...(await apiErr('addOwnGroupsOnly')) }, { status: 403 })
      }
      if (group.max_students && (maybeOne<{ n: number }>(roomRows)?.n ?? 0) >= group.max_students) {
        return NextResponse.json({ ...(await apiErr('groupFull', { max: group.max_students })) }, { status: 409 })
      }
    }

    // Step 1: the sign-in account. Its profile row appears by trigger as a
    // student with no institution; step 2 gives it its place.
    const { id: authUserId, error: authError } = await authCreateUser({ email: email.trim(), password, name: full_name })
    if (authError) {
      console.error('[create-user] account:', authError.message)
      // The account check is stricter than ours; say so plainly instead of the raw English message.
      if (authError.invalidEmail) {
        return NextResponse.json({ ...(await apiErr('emailFormatRejected', { email: email.trim() })) }, { status: 400 })
      }
      if (authError.duplicate) return NextResponse.json({ ...(await apiErr('accountExists')) }, { status: 409 })
      return NextResponse.json({ ...(await apiErr('userProfileCreateFailed')) }, { status: 400 })
    }

    // Step 2, one unit: the profile's role and institution (provision_user_profile,
    // the only way into a brand-new row), then for a student the private four-
    // part name and the group, then for a member-ID account the ID shown where
    // an email would be. Any failure rolls the unit back and removes the account,
    // so nothing half-made is left behind. Staff chose the password, so the
    // person must replace it at first sign-in (must_change_password).
    const isUniversityStudent = role === 'student' && (!hasCenter || resolveStudentAffiliation(callerProfile, body.is_university_student))
    const parts = studentParts
    let created: CreatedUser
    try {
      const results = await run(service, sql => [
        sql`select public.provision_user_profile(${authUserId}, ${tenant_id}, ${role}, ${email.trim()}, ${full_name}, ${isUniversityStudent}, true)`,
        ...(parts ? [
          sql`insert into public.student_names (user_id, first_name, father_name, grandfather_name, family_name, updated_at)
              values (${authUserId}, ${parts.first}, ${parts.father}, ${parts.grandfather}, ${parts.family}, now())
              on conflict (user_id) do update set first_name = excluded.first_name, father_name = excluded.father_name,
                grandfather_name = excluded.grandfather_name, family_name = excluded.family_name, updated_at = now()`,
          sql`update public.users set full_name = ${shortStudentName(parts)}, name_complete = true where id = ${authUserId}`,
        ] : []),
        ...(group ? [
          sql`insert into public.group_students (group_id, student_id) values (${group.id}, ${authUserId}) on conflict do nothing`,
          ...(group.course_id ? [sql`insert into public.course_enrollments (course_id, student_id, tenant_id) values (${group.course_id}, ${authUserId}, ${tenant_id}) on conflict do nothing`] : []),
        ] : []),
        // the member code is issued by the users trigger; show it where the email would be
        ...(byMemberId ? [sql`update public.users set email = member_code where id = ${authUserId} and member_code is not null`] : []),
        sql`select id, email, full_name, role, tenant_id, is_active, is_university_student, member_code, name_complete, created_at
              from public.users where id = ${authUserId}`,
      ])
      created = maybeOne<CreatedUser>(results[results.length - 1]) as CreatedUser
    } catch (e) {
      console.error('[create-user] profile:', e instanceof Error ? e.message : e)
      await authRemoveUser(authUserId)
      // The seat filled up between the pre-check and the write (DB trigger).
      const full = seatRoleFromDbError(e instanceof Error ? e.message : '')
      if (full) return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[full])) }, { status: 403 })
      return NextResponse.json({ ...(await apiErr('userProfileCreateFailed')) }, { status: 500 })
    }

    if (byMemberId) {
      // The temporary password is returned once, to the staff member who
      // created the account, and never stored or shown again.
      return NextResponse.json({ user: created, member_code: created.member_code ?? null, temp_password: password })
    }
    return NextResponse.json({ user: created })

  } catch (err) {
    console.error('[create-user] unexpected error:', err)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
