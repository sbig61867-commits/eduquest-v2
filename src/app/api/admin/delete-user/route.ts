import { getSessionUser } from '@/lib/auth'
import { authRemoveUser } from '@/lib/auth/better'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'
import { canManageAccountOf } from '@/lib/staff-auth'

export async function DELETE(request: Request) {
  const caller = await getSessionUser()
  if (!caller) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')

  // Both profiles in one unit, read as the caller: RLS decides what they may see
  // (a university_admin does not see another institution's accounts at all).
  type Profile = { role: string; tenant_id: string | null; permissions: Record<string, unknown> | null }
  const [callerRows, targetRows] = await run({ as: 'user', userId: caller.id }, sql => [
    sql`select role, tenant_id, permissions from public.users where id = ${caller.id}`,
    sql`select role, tenant_id from public.users where id = ${id && /^[0-9a-f-]{36}$/i.test(id) ? id : null}`,
  ])
  const callerProfile = maybeOne<Profile>(callerRows)
  const targetProfile = maybeOne<Omit<Profile, 'permissions'>>(targetRows)

  if (!callerProfile || !['university_admin', 'super_admin'].includes(callerProfile.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // 20 deletions per admin per hour
  const rl = await rateLimit(`delete-user:${caller.id}`, { limit: 20, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  // The target's institution and privilege ceiling are checked below
  if (!targetProfile) return NextResponse.json({ ...(await apiErr('userNotFound')) }, { status: 404 })

  // university_admin can only delete users within their own tenant
  if (callerProfile.role === 'university_admin' && targetProfile.tenant_id !== callerProfile.tenant_id) {
    return NextResponse.json({ ...(await apiErr('cannotDeleteOtherTenant')) }, { status: 403 })
  }

  // Cannot delete a user with equal or higher privilege
  const ROLE_RANK: Record<string, number> = { student: 0, teacher: 1, university_admin: 2, super_admin: 3 }
  if ((ROLE_RANK[targetProfile.role] ?? 0) >= (ROLE_RANK[callerProfile.role] ?? 0)) {
    return NextResponse.json({ ...(await apiErr('cannotDeleteEqualOrHigher')) }, { status: 403 })
  }
  // …and the capability for that role (an owner-restricted admin loses it).
  if (!canManageAccountOf(callerProfile, targetProfile.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // The account goes; its profile row follows by cascade.
  const { error } = await authRemoveUser(id)
  if (error) {
    console.error('[delete-user]', error.message)
    return NextResponse.json({ ...(await apiErr('userDeleteFailed')) }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
