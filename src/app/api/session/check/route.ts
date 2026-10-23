import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'

// GET /api/session/check — cheap liveness check for the user's session.
// Called every 60s by <TenantWatcher>. Returns { ok: true } if the user's
// account AND their tenant are both usable; otherwise { ok: false, reason }.
//
// One statement, as app_service in platform scope: the account and its
// institution's flags (the account may have been moved, or its institution
// suspended, since the session was signed). Only scalar flags — never
// institution data — reach the client.
export async function GET() {
  // The signed session context — no auth lookup on a poll. The live row read
  // below is what decides disabled/deleted/role changes.
  const user = await currentCtx()
  if (!user) return NextResponse.json({ ok: false, reason: 'no_session' }, { status: 401 })

  let profile: { is_active: boolean | null; tenant_id: string | null; role: string; tenant_active: boolean | null; tenant_exists: boolean } | null
  try {
    const [rows] = await run({ as: 'service', platform: true }, sql => [
      sql`select u.is_active, u.tenant_id, u.role, t.is_active as tenant_active, (t.id is not null) as tenant_exists
            from public.users u left join public.tenants t on t.id = u.tenant_id where u.id = ${user.sub}`,
    ])
    profile = maybeOne(rows)
  } catch (e) {
    // A transient error never kicks anyone out; the watcher retries next tick.
    console.error('[session/check]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: true, degraded: true })
  }
  if (!profile) return NextResponse.json({ ok: false, reason: 'user_deleted' })
  if (profile.is_active === false) return NextResponse.json({ ok: false, reason: 'user_disabled' })

  // Catch a role change (e.g. teacher demoted to student): the JWT's
  // app_metadata claim is stale until the access token naturally expires
  // (~1h), which would otherwise let a demoted user keep acting under their
  // old role for up to that long. Force a sign-out here instead so the next
  // login mints a fresh JWT with the current role.
  const claimedRole = user.role
  if (claimedRole && claimedRole !== profile.role) {
    return NextResponse.json({ ok: false, reason: 'role_changed' })
  }

  // super_admin has no tenant to check.
  if (profile.role === 'super_admin' || !profile.tenant_id) {
    return NextResponse.json({ ok: true })
  }

  if (!profile.tenant_exists) return NextResponse.json({ ok: false, reason: 'tenant_deleted' })
  if (profile.tenant_active === false) return NextResponse.json({ ok: false, reason: 'tenant_suspended' })

  return NextResponse.json({ ok: true })
}
