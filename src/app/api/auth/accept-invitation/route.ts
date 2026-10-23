import { authCreateUser, authRemoveUser } from '@/lib/auth/better'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'
import { captchaTokenFrom, ipLimitFor, type TieredLimit } from '@/lib/captcha'
import { isSeatRole, seatRoleFromDbError, seatStatus, SEAT_LIMIT_CODE } from '@/lib/seat-limit'
import { checkNameParts, shortStudentName, type NameParts } from '@/lib/person-name'

// Per IP: a whole class can join from one school IP behind a verified
// Turnstile token; without one the pre-Turnstile limit applies (src/lib/captcha.ts).
const IP_LIMITS: TieredLimit = {
  human: { limit: 60, windowSecs: 3600 },
  strict: { limit: 5, windowSecs: 3600 },
}

type Invitation = {
  id: string
  role: string
  tenant_id: string
  email: string | null
  is_public: boolean
  max_uses: number | null
  use_count: number
  is_university_student: boolean | null
  tenant_active: boolean
}

// POST /api/auth/accept-invitation — create an account from an invitation.
// There is no session yet: the token is the credential. It is checked through
// invitation_for_accept() (app_system only); once its institution is known,
// the rest runs as app_service pinned to that institution.
export async function POST(request: Request) {
 try {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  let body: { token?: string; email?: string; password?: string; fullName?: string; nameParts?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  // Rate limit per IP (the endpoint is public). A verified Turnstile token
  // earns the classroom-sized bucket; without one the strict limit applies.
  const { key, ...ipLimit } = await ipLimitFor('accept-invitation', ip, captchaTokenFrom(body), IP_LIMITS)
  const rl = await rateLimit(key, ipLimit)
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('tooManyRequests')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  const { token, email, password } = body
  if (!token || !email || !password) {
    return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ ...(await apiErr('passwordTooShort')) }, { status: 400 })
  }
  const cleanEmail = email.trim().toLowerCase()

  // ── Step 1: the invitation (fail fast; accept_invitation re-checks it atomically)
  const [invRows] = await run({ as: 'system' }, sql => [sql`select public.invitation_for_accept(${token}) as inv`])
  const inv = maybeOne<{ inv: Invitation | null }>(invRows)?.inv ?? null
  if (!inv) return NextResponse.json({ ...(await apiErr('invitationInvalid')) }, { status: 410 })
  if (inv.is_public && inv.max_uses != null && inv.use_count >= inv.max_uses) {
    return NextResponse.json({ ...(await apiErr('invitationMaxUses')) }, { status: 410 })
  }
  // Never mint an active account inside a suspended institution.
  if (!inv.tenant_active) return NextResponse.json({ ...(await apiErr('invitationInvalid')) }, { status: 410 })

  // ── Step 2: the name. A student gives the four-part name (kept private to
  // them; their profile shows first + family name), others a single full name.
  let fullName: string
  let studentParts: NameParts | null = null
  if (inv.role === 'student') {
    const name = checkNameParts(body.nameParts)
    if (!name.ok) {
      return NextResponse.json({ ...(await apiErr('studentNameInvalid')), fields: name.errors }, { status: 400 })
    }
    fullName = name.shortName
    studentParts = name.parts
  } else {
    fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
    if (!fullName) return NextResponse.json({ ...(await apiErr('missingFields')) }, { status: 400 })
    if (fullName.length < 2) return NextResponse.json({ ...(await apiErr('fullNameTooShort')) }, { status: 400 })
  }

  // A private invitation is bound to its invitee's email.
  if (!inv.is_public) {
    if (!inv.email || inv.email.toLowerCase() !== cleanEmail) {
      return NextResponse.json({ ...(await apiErr('invitationEmailMismatch')) }, { status: 403 })
    }
  }

  const service = { as: 'service', tenantId: inv.tenant_id } as const

  // Plan seat cap — checked before the account exists, so a refused request
  // leaves nothing to roll back. accept_invitation re-checks it race-free.
  if (isSeatRole(inv.role)) {
    const [tenantRows, countRows] = await run(service, sql => [
      sql`select student_limit, teacher_limit from public.tenants where id = ${inv.tenant_id}`,
      sql`select count(*)::int as n from public.users where tenant_id = ${inv.tenant_id} and role = ${inv.role} and is_active`,
    ])
    const t = maybeOne<{ student_limit: number | null; teacher_limit: number | null }>(tenantRows)
    const seat = seatStatus(inv.role === 'student' ? t?.student_limit : t?.teacher_limit, maybeOne<{ n: number }>(countRows)?.n ?? null)
    if (!seat.allowed) return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[inv.role])) }, { status: 403 })
  }

  // ── Step 3: the sign-in account (its profile row appears by trigger,
  // without an institution).
  const { id: userId, error: authError } = await authCreateUser({ email: cleanEmail, password, name: fullName })
  if (authError) {
    if (authError.duplicate) return NextResponse.json({ ...(await apiErr('accountExists')) }, { status: 409 })
    console.error('[accept-invitation] account:', authError.message)
    return NextResponse.json({ ...(await apiErr('signupFailed')) }, { status: 400 })
  }

  // ── Step 4, one unit: accept_invitation re-validates status, expiry and
  // max_uses under FOR UPDATE, sets role/institution/name on the new profile,
  // marks the use and enrols into the group/course — so a link capped at N
  // uses never admits more than N. Then, for a student, the invitation's
  // population and the private four-part name. Any failure rolls the unit back
  // (the invitation use is NOT consumed) and the account is removed again.
  const parts = studentParts
  try {
    await run(service, sql => [
      sql`select public.accept_invitation(${token}, ${userId}, ${fullName})`,
      ...(inv.role === 'student' ? [
        sql`update public.users set is_university_student = ${inv.is_university_student !== false} where id = ${userId}`,
      ] : []),
      ...(parts ? [
        sql`insert into public.student_names (user_id, first_name, father_name, grandfather_name, family_name, updated_at)
            values (${userId}, ${parts.first}, ${parts.father}, ${parts.grandfather}, ${parts.family}, now())
            on conflict (user_id) do update set first_name = excluded.first_name, father_name = excluded.father_name,
              grandfather_name = excluded.grandfather_name, family_name = excluded.family_name, updated_at = now()`,
        sql`update public.users set full_name = ${shortStudentName(parts)}, name_complete = true where id = ${userId}`,
      ] : []),
    ])
  } catch (err) {
    await authRemoveUser(userId).catch(e => console.error('[accept-invitation] ROLLBACK FAILED, orphaned user:', userId, e))
    const code = err instanceof Error ? err.message : String(err)
    // Someone else consumed the last use (or it expired) between the check and the accept.
    if (code.includes('INVITATION_INVALID_OR_EXPIRED')) return NextResponse.json({ ...(await apiErr('invitationUnusable')) }, { status: 410 })
    // The last seat was taken between the pre-check and the accept.
    const full = seatRoleFromDbError(code)
    if (full) return NextResponse.json({ ...(await apiErr(SEAT_LIMIT_CODE[full])) }, { status: 403 })
    // The invitation's group hit its seat cap (the use was not consumed).
    if (code.includes('GROUP_FULL')) return NextResponse.json({ ...(await apiErr('invitationGroupFull')) }, { status: 409 })
    console.error('[accept-invitation] error after the account was created:', code)
    return NextResponse.json({ ...(await apiErr('signupFailed')) }, { status: 500 })
  }

  return NextResponse.json({ email: cleanEmail })
 } catch (err) {
  console.error('[accept-invitation] unexpected error:', err)
  return NextResponse.json({ ...(await apiErr('signupServerError')) }, { status: 500 })
 }
}
