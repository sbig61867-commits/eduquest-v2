import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type DbContext } from '@/lib/db/sql'
import { sendInvitationEmail } from '@/lib/email'
import { getLocale } from 'next-intl/server'
import { isLocale, toLocale } from '@/i18n/config'
import { rateLimit } from '@/lib/rate-limit'
import { invitationDefaultsFrom } from '@/lib/settings'
import { canManageAccountOf } from '@/lib/staff-auth'
import { resolveStudentAffiliation } from '@/lib/student-affiliation'
import { isSeatRole, seatStatus, SEAT_LIMIT_CODE } from '@/lib/seat-limit'

// Role ceiling: what roles each caller can invite
const ROLE_CEILING: Record<string, string[]> = {
  super_admin:      ['university_admin', 'center_manager', 'teacher', 'student'],
  university_admin: ['center_manager', 'teacher', 'student'],
  center_manager:   ['teacher', 'student'],
  teacher:          ['student'],
}

// Staff seats are never handed out as a shareable public link.
const PRIVATE_ONLY_INVITE_ROLES = new Set(['university_admin', 'center_manager'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIST_LIMIT = 1000


/** The owner works across institutions; everyone else is pinned to their own. */
function scopeFor(role: string | null, tenantId: string | null): DbContext | null {
  if (role === 'super_admin') return { as: 'service', platform: true }
  return tenantId ? { as: 'service', tenantId } : null
}

// Default expiry durations come from platform_settings ('invitation_defaults'),
// editable by the super admin in /super-admin/settings, with hard-coded
// fallbacks in src/lib/settings.ts.

// ── GET /api/invitations ─────────────────────────────────────
// Returns all invitations visible to the current user, with the institution's
// plan seats — in one unit, from the caller's live row: super_admin sees all,
// others their institution's, and a teacher only the ones they created.
export async function GET() {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const scope = scopeFor(ctx.role, ctx.tenant_id)
  if (!scope) return NextResponse.json({ ...(await apiErr('profileNotFound')) }, { status: 403 })

  try {
    const [me, list, seats] = await run(scope, sql => [
      sql`select role, tenant_id from public.users where id = ${ctx.sub} and is_active is not false`,
      sql`select i.id, i.token, i.email, i.role, i.tenant_id, i.group_id, i.invited_by, i.status, i.expires_at, i.accepted_at,
                 i.accepted_by, i.created_at, i.group_name_snapshot, i.is_public, i.max_uses, i.use_count, i.course_id,
                 i.is_university_student,
                 case when t.id is null then null else json_build_object('name', t.name) end as tenants,
                 case when g.id is null then null else json_build_object('name', g.name) end as groups,
                 case when u.id is null then null else json_build_object('full_name', u.full_name, 'email', u.email) end as inviter
            from public.invitations i
            left join public.tenants t on t.id = i.tenant_id
            left join public.groups g on g.id = i.group_id
            left join public.users u on u.id = i.invited_by
           where exists (select 1 from public.users m where m.id = ${ctx.sub} and m.is_active is not false
                           and (m.role = 'super_admin' or i.tenant_id = m.tenant_id)
                           and (m.role <> 'teacher' or i.invited_by = m.id))
           order by i.created_at desc
           limit ${LIST_LIMIT}`,
      sql`select t.student_limit, t.teacher_limit,
                 (select count(*) from public.users u where u.tenant_id = t.id and u.role = 'student' and u.is_active)::int as students,
                 (select count(*) from public.users u where u.tenant_id = t.id and u.role = 'teacher' and u.is_active)::int as teachers
            from public.tenants t where t.id = ${ctx.tenant_id}::uuid`,
    ])
    if (!maybeOne(me)) return NextResponse.json({ ...(await apiErr('profileNotFound')) }, { status: 403 })
    // The institution's plan seats, so the screen can say up front that new
    // links for a full role are paused (the POST refuses them regardless).
    const s = maybeOne<{ student_limit: number | null; teacher_limit: number | null; students: number; teachers: number }>(seats)
    return NextResponse.json({
      invitations: list,
      seats: s ? { student: seatStatus(s.student_limit, s.students), teacher: seatStatus(s.teacher_limit, s.teachers) } : null,
    })
  } catch (e) {
    console.error('[api/invitations GET]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}

// ── POST /api/invitations ────────────────────────────────────
// Creates a new invitation. Sends back the invitation URL.
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }

  if (!ROLE_CEILING[ctx.role ?? '']) {
    return NextResponse.json({ ...(await apiErr('cannotInvite')) }, { status: 403 })
  }

  // 50 invitations per user per hour
  const rl = await rateLimit(`invitations:${user.id}`, { limit: 50, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: {
    email?: string
    role?: string
    tenant_id?: string
    group_id?: string
    expires_hours?: number
    is_public?: boolean
    max_uses?: number
    is_university_student?: boolean
  }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { email, role, group_id, expires_hours } = body
  const isPublic = body.is_public === true
  const maxUses  = body.max_uses ? Number(body.max_uses) : null

  // ── Validate role (against the session's role; re-checked live below) ──
  if (!role) {
    return NextResponse.json({ ...(await apiErr('roleRequired')) }, { status: 400 })
  }
  if (!ROLE_CEILING[ctx.role!].includes(role)) {
    return NextResponse.json({ error: `Your role (${ctx.role}) cannot invite a ${role}` }, { status: 403 })
  }

  // ── Public link rules ────────────────────────────────────
  // High-privilege staff roles must ALWAYS be email-specific, whoever invites:
  // a shareable public link to an admin/centre-manager seat would let anyone
  // holding the URL claim staff access to the tenant.
  if (isPublic && PRIVATE_ONLY_INVITE_ROLES.has(role)) {
    return NextResponse.json({ ...(await apiErr('staffInviteMustBePrivate')) }, { status: 400 })
  }

  // ── Email validation ─────────────────────────────────────
  const trimmedEmail = !isPublic && email ? email.trim().toLowerCase() : null
  if (!isPublic) {
    if (!email?.trim()) {
      return NextResponse.json({ ...(await apiErr('emailRequiredPrivate')) }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ...(await apiErr('invalidEmail')) }, { status: 400 })
    }
  }

  // ── Resolve tenant_id ────────────────────────────────────
  const tenant_id = ctx.role === 'super_admin' ? (body.tenant_id ?? null) : ctx.tenant_id
  if (!tenant_id) {
    return NextResponse.json({ ...(await apiErr('tenantIdRequiredForRole')) }, { status: 400 })
  }
  if (!UUID.test(tenant_id)) return NextResponse.json({ ...(await apiErr('tenantNotFound')) }, { status: 404 })
  if (group_id && !UUID.test(group_id)) return NextResponse.json({ ...(await apiErr('groupNotInTenant')) }, { status: 400 })
  const scope = scopeFor(ctx.role, tenant_id)!

  // ── Everything the decision needs, in one unit ───────────
  // the caller's live row, the institution (active, centre, seats, language),
  // the group, and whether the address is already taken — plus the expiry
  // defaults (platform settings, read as the user) alongside.
  let me: { role: string; tenant_id: string | null; permissions: Record<string, unknown> | null; full_name: string | null } | null
  let tenant: { is_active: boolean; has_center: boolean | null; name: string | null; institution_type: string | null; default_locale: string | null; student_limit: number | null; teacher_limit: number | null; students: number; teachers: number } | null
  let group: { name: string; teacher_id: string; tenant_id: string } | null
  let taken: { in_tenant: boolean } | null
  let inAuth: boolean
  let defaultsValue: unknown
  try {
    const [rows, settings] = await Promise.all([
      run(scope, sql => [
        sql`select role, tenant_id, permissions, full_name from public.users where id = ${user.id} and is_active is not false`,
        sql`select t.is_active, t.has_center, t.name, t.institution_type, t.default_locale, t.student_limit, t.teacher_limit,
                   (select count(*) from public.users u where u.tenant_id = t.id and u.role = 'student' and u.is_active)::int as students,
                   (select count(*) from public.users u where u.tenant_id = t.id and u.role = 'teacher' and u.is_active)::int as teachers
              from public.tenants t where t.id = ${tenant_id}`,
        sql`select name, teacher_id, tenant_id from public.groups where id = ${group_id ?? null}::uuid`,
        sql`select (tenant_id = ${tenant_id}) as in_tenant from public.users where email = ${trimmedEmail}::text limit 1`,
        sql`select coalesce(public.check_email_in_auth(${trimmedEmail}::text), false) as taken where ${trimmedEmail}::text is not null`,
      ]),
      run({ as: 'user', userId: user.id }, sql => [
        sql`select value from public.platform_settings where key = 'invitation_defaults'`,
      ]),
    ])
    me = maybeOne(rows[0])
    tenant = maybeOne(rows[1])
    group = maybeOne(rows[2])
    taken = maybeOne(rows[3])
    inAuth = maybeOne<{ taken: boolean }>(rows[4])?.taken === true
    defaultsValue = maybeOne<{ value: unknown }>(settings[0])?.value
  } catch (e) {
    console.error('[api/invitations POST] read', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }

  // The live row decides (a demoted or moved account gains nothing from its session).
  if (!me || me.role !== ctx.role || (me.role !== 'super_admin' && me.tenant_id !== tenant_id)) {
    return NextResponse.json({ ...(await apiErr('profileNotFound')) }, { status: 403 })
  }
  // Staff (admins included) need the capability for the invited role; a
  // teacher's ceiling is already students of their own groups only.
  if (me.role !== 'teacher' && !canManageAccountOf(me, role)) {
    return NextResponse.json({ ...(await apiErr('cannotInviteRole')) }, { status: 403 })
  }
  if (!tenant) return NextResponse.json({ ...(await apiErr('tenantNotFound')) }, { status: 404 })
  if (me.role === 'super_admin' && !tenant.is_active) {
    return NextResponse.json({ ...(await apiErr('tenantSuspended')) }, { status: 403 })
  }

  // ── Centre features ──────────────────────────────────────
  // No continuing-education centre ⇒ no centre managers, and every student
  // belongs to the institution (the DB trigger refuses the former as well).
  const hasCenter = tenant.has_center !== false
  if (role === 'center_manager' && !hasCenter) {
    return NextResponse.json({ ...(await apiErr('noCentre')) }, { status: 409 })
  }

  // ── Plan seat cap ────────────────────────────────────────
  // An institution at its student/teacher limit cannot hand out new links
  // for that role until the owner raises the limit or a seat is freed.
  // Links created earlier stay, but every join is refused while full
  // (accept-invitation + the DB trigger), so none of them can overshoot.
  if (isSeatRole(role)) {
    const seat = role === 'student' ? seatStatus(tenant.student_limit, tenant.students) : seatStatus(tenant.teacher_limit, tenant.teachers)
    if (!seat.allowed) {
      return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[role])), limit: seat.limit }, { status: 403 })
    }
  }

  // ── Validate group_id if provided ───────────────────────
  if (group_id) {
    if (role !== 'student') {
      return NextResponse.json({ ...(await apiErr('groupOnlyForStudents')) }, { status: 400 })
    }
    if (!group || group.tenant_id !== tenant_id) {
      return NextResponse.json({ ...(await apiErr('groupNotInTenant')) }, { status: 400 })
    }
    // Teachers can only invite to their own groups
    if (me.role === 'teacher' && group.teacher_id !== user.id) {
      return NextResponse.json({ ...(await apiErr('inviteOwnGroupsOnly')) }, { status: 403 })
    }
  }

  // ── Email duplicate checks (private invitations only) ────
  if (taken) {
    return NextResponse.json({ ...(await apiErr(taken.in_tenant ? 'emailExists' : 'emailInOtherTenant')) }, { status: 409 })
  }
  if (inAuth) return NextResponse.json({ ...(await apiErr('emailRegistered')) }, { status: 409 })

  // ── Compute expiry ───────────────────────────────────────
  const defaults = invitationDefaultsFrom(defaultsValue)
  const roleDefault = defaults[role as 'university_admin' | 'teacher' | 'student'] ?? 48
  const hours = Math.min(Math.max(expires_hours ?? roleDefault, 1), defaults.max_expiry_hours)
  const expires_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()

  // Carried onto the account when the invitation is accepted. Gated the same
  // way as direct account creation — see src/lib/student-affiliation.ts.
  const universityStudent = role === 'student' ? !hasCenter || resolveStudentAffiliation(me, body.is_university_student) : true

  // ── Insert ─ only while the caller is still live with the role checked ──
  let invitation: { token: string; email: string | null; expires_at: string } & Record<string, unknown>
  try {
    const [rows] = await run(scope, sql => [
      sql`insert into public.invitations (email, role, tenant_id, group_id, group_name_snapshot, invited_by, expires_at,
                                          is_public, max_uses, is_university_student)
          select ${trimmedEmail}, ${role}, ${tenant_id}, ${group_id ?? null}, ${group?.name ?? null}, ${user.id}, ${expires_at},
                 ${isPublic}, ${isPublic ? maxUses : null}, ${universityStudent}
           where exists (select 1 from public.users where id = ${user.id} and is_active is not false and role = ${me.role}
                           and (role = 'super_admin' or tenant_id = ${tenant_id}))
          returning id, token, email, role, tenant_id, group_id, invited_by, status, expires_at, accepted_at, accepted_by,
                    created_at, group_name_snapshot, is_public, max_uses, use_count, course_id, is_university_student`,
    ])
    const created = maybeOne<typeof invitation>(rows)
    if (!created) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    invitation = created
  } catch (e) {
    // Unique constraint violation = pending invitation already exists for this email+tenant
    if ((e as { code?: string }).code === '23505') {
      return NextResponse.json({ ...(await apiErr('pendingInvitationExists')) }, { status: 409 })
    }
    console.error('[api/invitations POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }

  const baseUrl = (() => {
    const url = process.env.NEXT_PUBLIC_APP_URL
    if (url) return url.replace(/\/$/, '')
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
    return 'http://localhost:3000'
  })()
  const joinUrl = `${baseUrl}/join/${invitation.token}`

  // Send invitation email (private links only — public links are shared manually).
  // The invitee has no account, so no users.locale yet: write in the
  // institution's language, else the inviter's current one.
  if (!isPublic && invitation.email) {
    const emailLocale = isLocale(tenant.default_locale) ? tenant.default_locale : toLocale(await getLocale())
    sendInvitationEmail({
      to:              invitation.email,
      role,
      tenantName:      tenant.name ?? null,
      institutionType: tenant.institution_type ?? null,
      joinUrl,
      expiresAt:       invitation.expires_at,
      inviterName:     me.full_name ?? undefined,
      locale:          emailLocale,
    }).catch(err => console.error('[email] Failed to send invitation email:', err))
  }

  return NextResponse.json({ invitation, joinUrl }, { status: 201 })
}
