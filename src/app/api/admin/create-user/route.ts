import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { checkSeatLimit, isSeatRole, seatRoleFromDbError, SEAT_LIMIT_CODE } from '@/lib/seat-limit'
import { canManageAccountOf } from '@/lib/staff-auth'
import { resolveStudentAffiliation } from '@/lib/student-affiliation'
import { getTenantSettings } from '@/lib/structure-mode'
import { checkNameParts, type NameParts } from '@/lib/person-name'
import { saveStudentName } from '@/lib/student-names'
import { enrolStudentInGroup, groupHasRoom, type EnrolmentGroup } from '@/lib/group-enrolment'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE env vars')
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

function extractError(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  const e = err as Record<string, unknown>
  const msg = (e.message as string) || (e.msg as string) || (e.error_description as string) || (e.code as string)
  if (msg) return msg
  const json = JSON.stringify(err)
  return (!json || json === '{}') ? 'Unknown error' : json
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user: caller } } = await supabase.auth.getUser()
    if (!caller) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

    const { data: callerProfile } = await supabase
      .from('users').select('role, tenant_id, permissions').eq('id', caller.id).single()

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
    const { email, password, role } = body

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
    const groupId = typeof body.group_id === 'string' && body.group_id ? body.group_id : null
    if (groupId && role !== 'student') {
      return NextResponse.json({ ...(await apiErr('groupOnlyForStudents')) }, { status: 400 })
    }
    if (isTeacher && !groupId) {
      return NextResponse.json({ ...(await apiErr('teacherGroupRequired')) }, { status: 400 })
    }

    const tenant_id = callerProfile.role === 'super_admin'
      ? (body.tenant_id ?? null)
      : callerProfile.tenant_id

    if (!tenant_id) {
      return NextResponse.json({ ...(await apiErr('tenantRequiredForRole')) }, { status: 400 })
    }

    const adminClient = getAdminClient()

    // Never mint an active account inside a suspended institution.
    const { data: tenant } = await adminClient.from('tenants').select('is_active').eq('id', tenant_id).maybeSingle()
    if (!tenant) return NextResponse.json({ ...(await apiErr('tenantNotFound')) }, { status: 404 })
    if (!tenant.is_active) return NextResponse.json({ ...(await apiErr('tenantSuspended')) }, { status: 403 })

    const { has_center: hasCenter } = await getTenantSettings(adminClient, tenant_id)

    // Plan seat cap (students / teachers) — checked before the auth identity
    // exists, so a refused request leaves nothing to roll back. The DB trigger
    // users_enforce_seat_limit re-checks it race-free on the upsert below.
    if (isSeatRole(role)) {
      const seat = await checkSeatLimit(adminClient, tenant_id, role)
      if (!seat.allowed) {
        return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[role])), limit: seat.limit }, { status: 403 })
      }
    }

    // The group the new student joins (optional for staff, required for a
    // teacher): same rules as an invitation into a group — in this tenant, the
    // teacher's own, and not at its seat cap. Read through the caller's session.
    let group: EnrolmentGroup | null = null
    if (groupId) {
      const { data: row } = await supabase.from('groups').select('*').eq('id', groupId).maybeSingle()
      if (!row || row.tenant_id !== tenant_id) {
        return NextResponse.json({ ...(await apiErr('groupNotInTenant')) }, { status: 400 })
      }
      if (isTeacher && row.teacher_id !== caller.id) {
        return NextResponse.json({ ...(await apiErr('addOwnGroupsOnly')) }, { status: 403 })
      }
      group = row as EnrolmentGroup
      if (!(await groupHasRoom(adminClient, group))) {
        return NextResponse.json({ ...(await apiErr('groupFull', { max: group.max_students ?? 0 })) }, { status: 409 })
      }
    }

    // Step 1: create the auth identity (trigger will insert a placeholder profile)
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      // No role/tenant_id in metadata — trigger now always defaults to 'student'/NULL
      user_metadata: { full_name },
    })

    if (authError) {
      console.error('[create-user] authError:', authError)
      const message = extractError(authError)
      // Supabase's own email check is stricter than ours; say so plainly instead of the raw English message.
      if (/invalid format/i.test(message)) {
        return NextResponse.json(
          { ...(await apiErr('emailFormatRejected', { email: email.trim() })) },
          { status: 400 },
        )
      }
      return NextResponse.json({ error: message }, { status: 400 })
    }

    // Step 2: explicitly set role + tenant — never rely on the trigger for this.
    // Upsert handles the case where the trigger already inserted the row.
    const { data: profile, error: upsertError } = await adminClient
      .from('users')
      .upsert({
        id: authData.user.id,
        email: email.trim(),
        full_name,
        role,
        tenant_id,
        is_active: true,
        // Which student population this account belongs to. Requesting the
        // university population needs `announce_to_university`; a centre
        // manager without it can only ever add centre trainees.
        ...(role === 'student'
          // Without a centre every student belongs to the institution itself.
          ? { is_university_student: !hasCenter || resolveStudentAffiliation(callerProfile, body.is_university_student) }
          : {}),
      })
      .select('*')
      .single()

    if (upsertError) {
      console.error('[create-user] profile upsert error:', upsertError)
      // Rollback: delete the auth user so we don't leave orphaned auth entries
      await adminClient.auth.admin.deleteUser(authData.user.id)
      // The seat filled up between the pre-check and the write (DB trigger).
      const full = seatRoleFromDbError(upsertError.message)
      if (full) return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[full])) }, { status: 403 })
      return NextResponse.json({ ...(await apiErr('userProfileCreateFailed')) }, { status: 500 })
    }

    // Step 3 (students): the private four-part name, then the group. Any
    // failure removes the account again, so nothing half-made is left behind.
    let created = profile
    try {
      if (studentParts) {
        const stored = await saveStudentName(adminClient, authData.user.id, studentParts)
        // The short name is stored only once the parts were saved privately.
        created = { ...profile, full_name: stored, name_complete: stored === full_name }
      }
      if (group) {
        const { error: enrolErr } = await enrolStudentInGroup(adminClient, group, authData.user.id)
        if (enrolErr) throw new Error(`group enrolment: ${enrolErr.message}`)
      }
    } catch (e) {
      console.error('[create-user] after profile:', e)
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ ...(await apiErr('userProfileCreateFailed')) }, { status: 500 })
    }

    return NextResponse.json({ user: created })

  } catch (err) {
    console.error('[create-user] unexpected error:', err)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
