import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
 try {
  // Rate-limit by IP: 5 registration attempts per hour per IP to prevent bulk account creation
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = await rateLimit(`accept-invitation:${ip}`, { limit: 5, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: { token?: string; email?: string; password?: string; fullName?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { token, email, password, fullName } = body

  if (!token || !email || !password || !fullName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }
  if (fullName.trim().length < 2) {
    return NextResponse.json({ error: 'Full name must be at least 2 characters' }, { status: 400 })
  }

  const cleanEmail = email.trim().toLowerCase()
  const admin = getAdminClient()

  // ── Step 1: validate & lock invitation ───────────────────────
  const { data: inv, error: invErr } = await admin
    .from('invitations')
    .select('id, role, tenant_id, email, group_id, course_id, is_public, max_uses, use_count, status, expires_at')
    .eq('token', token)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .single()

  if (invErr || !inv) {
    return NextResponse.json(
      { error: 'This invitation link is invalid or has expired.' },
      { status: 410 }
    )
  }

  // Check max_uses for public links
  if (inv.is_public && inv.max_uses != null && inv.use_count >= inv.max_uses) {
    return NextResponse.json(
      { error: 'This invitation link has reached its maximum number of uses.' },
      { status: 410 }
    )
  }

  // ── Step 2: verify email for private invitations ──────────────
  if (!inv.is_public) {
    if (!inv.email || inv.email.toLowerCase() !== cleanEmail) {
      return NextResponse.json(
        { error: 'The email address does not match this invitation.' },
        { status: 403 }
      )
    }
  }

  // ── Step 3: create auth user ──────────────────────────────────
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
  })

  if (authError) {
    const m = (authError.message ?? '').toLowerCase()
    // Supabase signals a duplicate via several shapes depending on version:
    // message contains "already"/"registered"/"exists", code 'email_exists', or HTTP 422.
    const isDuplicate =
      m.includes('already') || m.includes('registered') || m.includes('exists') ||
      authError.code === 'email_exists' || authError.status === 422
    if (isDuplicate) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try logging in instead.' },
        { status: 409 }
      )
    }
    console.error('[accept-invitation] createUser error:', authError)
    return NextResponse.json({ error: authError.message || 'Could not create account.' }, { status: 400 })
  }

  const userId = authData.user.id

  try {
    // ── Steps 4-7, atomically: the earlier SELECT (above) was only a
    // fail-fast/email-match check and is NOT race-safe on its own — two
    // concurrent accepts of a multi-use link could both pass it before
    // either write happened. `accept_invitation` re-validates status/expiry/
    // max_uses under `SELECT ... FOR UPDATE` in one transaction, then sets
    // role/tenant/full_name on the (trigger-created) profile row, marks the
    // invitation used, and enrolls the student in the group/course — so a
    // link capped at N uses can never admit more than N under concurrency.
    const { error: rpcErr } = await admin.rpc('accept_invitation', {
      p_token: token,
      p_user_id: userId,
      p_full_name: fullName.trim(),
    })

    if (rpcErr) {
      const code = rpcErr.message ?? ''
      if (code.includes('INVITATION_INVALID_OR_EXPIRED')) {
        // Someone else consumed the last use (or it expired) between our
        // fail-fast check and this atomic accept — not a server error.
        await admin.auth.admin.deleteUser(userId).catch(e =>
          console.error('[accept-invitation] ROLLBACK FAILED, orphaned user:', userId, e)
        )
        return NextResponse.json(
          { error: 'This invitation link is invalid, expired, or has reached its maximum number of uses.' },
          { status: 410 }
        )
      }
      throw new Error(`accept_invitation: ${rpcErr.message}`)
    }

    return NextResponse.json({ email: cleanEmail })

  } catch (err) {
    // Rollback: delete the auth user so the email can be used again
    await admin.auth.admin.deleteUser(userId).catch(e =>
      console.error('[accept-invitation] ROLLBACK FAILED, orphaned user:', userId, e)
    )
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[accept-invitation] error after auth user created:', detail)
    return NextResponse.json(
      { error: 'Registration failed. Please try again or contact support.' },
      { status: 500 }
    )
  }
 } catch (outer) {
    // Any unhandled error in steps 1-3 (before the auth user is created) lands here.
    // Without this, the route would return a 500 HTML page and the client would
    // show its generic "Registration failed" fallback, hiding the real cause.
    const detail = outer instanceof Error ? outer.message : String(outer)
    console.error('[accept-invitation] unhandled error:', detail)
    return NextResponse.json(
      { error: 'Registration failed due to a server error. Please try again or contact support.' },
      { status: 500 }
    )
 }
}
