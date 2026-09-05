import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getRoleDashboardPath } from '@/lib/utils'
import { rateLimit } from '@/lib/rate-limit'
import type { Role } from '@/types'

interface ProfileRow {
  id: string
  role: Role
  tenant_id: string | null
  created_at: string
  email: string
}

interface InvitationRow {
  id: string
  role: Role
  tenant_id: string
  email: string | null
  is_public: boolean
  max_uses: number | null
  use_count: number
  status: string
  expires_at: string
}

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// A public.users row is only "genuinely created by this very sign-in" if it's
// this fresh. Anything older is a pre-existing account (its tenant may have
// been removed later) and must never be deleted — every FK into users is
// ON DELETE CASCADE.
const FRESH_ACCOUNT_WINDOW_MS = 2 * 60 * 1000

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const inviteToken = searchParams.get('invite')
  // Only allow same-origin relative paths — reject //host, /\host, and absolute URLs
  const rawNext = searchParams.get('next') ?? '/'
  const next = /^\/[^/\\]/.test(rawNext) ? rawNext : '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  const { data: profile } = await supabase
    .from('users')
    .select('id, role, tenant_id, created_at, email')
    .eq('id', user.id)
    .single<ProfileRow>()

  if (!profile) {
    // Profile row missing entirely (handle_new_user failed) — nothing to gate on.
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  // `next` (e.g. /reset-password after a password-recovery code) is honoured
  // ONLY for accounts that pass the gate below. Returning on `next` earlier —
  // before the gate — would defeat the whole cleanup: the OAuth redirect
  // allow-list permits `/auth/callback?**`, so anyone could self-initiate a
  // Google sign-in with `?next=/x`, skip branch (d) entirely and leave a
  // permanent auth.users + public.users row behind (the exact DB/MAU bloat
  // this gate exists to prevent).
  const destination = (role: Role) => (next !== '/' ? next : getRoleDashboardPath(role))

  // (a) super_admin — ALWAYS allowed. Checked first and unconditionally:
  // super_admin legitimately has tenant_id = NULL, so if this check ran after
  // the tenant_id check below, the owner's own account would look like an
  // uninvited stranger and get deleted.
  if (profile.role === 'super_admin') {
    return NextResponse.redirect(`${origin}${destination(profile.role)}`)
  }

  // (b) already provisioned — existing user (password or Google) signing back in.
  if (profile.tenant_id) {
    return NextResponse.redirect(`${origin}${destination(profile.role)}`)
  }

  // (c) no tenant yet, but an invitation token was carried through the OAuth
  // round trip — try to complete the invitation now that we have a
  // Google-verified email, using the same rules as the password-based flow
  // in api/auth/accept-invitation.
  if (inviteToken) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rl = await rateLimit(`accept-invitation:${ip}`, { limit: 5, windowSecs: 3600 })

    if (rl.allowed) {
      const admin = getAdminClient()

      const { data: inv } = await admin
        .from('invitations')
        .select('id, role, tenant_id, email, is_public, max_uses, use_count, status, expires_at')
        .eq('token', inviteToken)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .single<InvitationRow>()

      const googleEmail = (user.email ?? '').toLowerCase()
      const emailMatches = !!inv && (inv.is_public || (!!inv.email && inv.email.toLowerCase() === googleEmail))
      const withinUses = !!inv && (!inv.is_public || inv.max_uses == null || inv.use_count < inv.max_uses)

      if (inv && emailMatches && withinUses) {
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>
        const fullName =
          (typeof meta.full_name === 'string' && meta.full_name) ||
          (typeof meta.name === 'string' && meta.name) ||
          user.email ||
          ''

        const { error: rpcErr } = await admin.rpc('accept_invitation', {
          p_token: inviteToken,
          p_user_id: user.id,
          p_full_name: fullName,
        })

        if (!rpcErr) {
          return NextResponse.redirect(`${origin}${getRoleDashboardPath(inv.role)}`)
        }
        // Fall through to (d): the invitation was consumed/expired between
        // our fail-fast check and the atomic RPC, or something else failed.
      }
    }
    // Rate-limited or invalid invitation — fall through to (d) rather than
    // silently provisioning; failing closed here is the safe default.
  }

  // (d) no tenant and no valid invitation — reject and clean up.
  //
  // Re-read the profile first. `accept_invitation` can commit in the database
  // and still surface an error to us (dropped response, timeout), which would
  // land us here holding a user that is now legitimately provisioned. Deleting
  // them would cascade (users_id_fkey is ON DELETE CASCADE) and take their
  // fresh group enrolment with it — while the invitation use is already spent,
  // so the link could not be used again. Trust the database, not the RPC's
  // return value.
  const { data: recheck } = await supabase
    .from('users')
    .select('id, role, tenant_id, created_at, email')
    .eq('id', user.id)
    .single<ProfileRow>()

  if (recheck?.tenant_id) {
    return NextResponse.redirect(`${origin}${destination(recheck.role)}`)
  }

  const createdRecently = Date.now() - new Date(profile.created_at).getTime() < FRESH_ACCOUNT_WINDOW_MS
  if (!createdRecently) {
    // A pre-existing account that lost its tenant — never delete it. This is
    // the state the proxy already reports as `university_removed`.
    await supabase.auth.signOut().catch(() => {})
    return NextResponse.redirect(`${origin}/login?error=university_removed`)
  }

  const admin = getAdminClient()
  await admin.auth.admin.deleteUser(user.id).catch(e =>
    console.error('[auth/callback] cleanup deleteUser failed for', user.id, e)
  )

  await supabase.auth.signOut().catch(() => {})
  return NextResponse.redirect(`${origin}/login?error=invitation_required`)
}
