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
  // Rate-limit by IP: 5 registration attempts per hour to prevent bulk account creation.
  // The application should ideally obtain the real client IP from trusted platform
  // headers rather than accepting an arbitrary x-forwarded-for value.
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
  if (fullName.trim().length < 2 || fullName.trim().length > 120) {
    return NextResponse.json({ error: 'Full name must be between 2 and 120 characters' }, { status: 400 })
  }
  if (token.length > 200) {
    return NextResponse.json({ error: 'Invalid invitation token' }, { status: 400 })
  }

  const cleanEmail = email.trim().toLowerCase()
  if (cleanEmail.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  const admin = getAdminClient()

  // ── Step 1: validate invitation ────────────────────────────────
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

  // Private invitations bind the account to the invited email.
  if (!inv.is_public && (!inv.email || inv.email.toLowerCase() !== cleanEmail)) {
    return NextResponse.json(
      { error: 'The email address does not match this invitation.' },
      { status: 403 }
    )
  }

  // ── Step 2: create auth user ──────────────────────────────────
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
  })

  if (authError) {
    const m = (authError.message ?? '').toLowerCase()
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
    return NextResponse.json({ error: 'Could not create account. Please try again.' }, { status: 400 })
  }

  const userId = authData.user.id

  try {
    // ── Step 3: create user profile ─────────────────────────────
    const { error: profileErr } = await admin.from('users').upsert({
      id:        userId,
      email:     cleanEmail,
      full_name: fullName.trim(),
      role:      inv.role,
      tenant_id: inv.tenant_id,
      is_active: true,
    }, { onConflict: 'id' })

    if (profileErr) throw new Error(`Profile: ${profileErr.message}`)

    // ── Step 4: consume public invitation atomically ────────────
    // The previous check-then-increment sequence allowed two concurrent
    // registrations to consume the same final public-link slot. The RPC locks
    // the invitation row and increments use_count in one database statement.
    if (inv.is_public) {
      const { error: redeemErr } = await admin.rpc('redeem_public_invitation', {
        p_invitation_id: inv.id,
      })
      if (redeemErr) {
        if (redeemErr.message?.includes('INVITATION_UNAVAILABLE')) {
          throw new Error('INVITATION_UNAVAILABLE')
        }
        throw new Error(`Invitation redemption: ${redeemErr.message}`)
      }
    } else {
      // Private links are single-use and remain email-bound.
      const { error: invitationUpdateError } = await admin.from('invitations').update({
        status:      'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      }).eq('id', inv.id).eq('status', 'pending')

      if (invitationUpdateError) throw new Error(`Invitation: ${invitationUpdateError.message}`)
    }

    // ── Step 5: enroll in group (student only) ─────────────────
    if (inv.group_id && inv.role === 'student') {
      const { error } = await admin.from('group_students')
        .upsert({ group_id: inv.group_id, student_id: userId }, { onConflict: 'group_id,student_id', ignoreDuplicates: true })
      if (error) throw new Error(`Group enrollment: ${error.message}`)
    }

    // ── Step 6: enroll in course (student only) ────────────────
    if (inv.course_id && inv.role === 'student') {
      const { error } = await admin.from('course_enrollments')
        .upsert({
          course_id: inv.course_id,
          student_id: userId,
          tenant_id: inv.tenant_id,
        }, { onConflict: 'course_id,student_id', ignoreDuplicates: true })
      if (error) throw new Error(`Course enrollment: ${error.message}`)
    }

    return NextResponse.json({ email: cleanEmail })

  } catch (err) {
    // Rollback: delete the auth user so the email can be used again.
    // If a public slot was consumed before a later enrollment failed, the slot
    // remains consumed rather than risking over-redemption; the invitation's
    // configured cap is a security boundary, not a best-effort counter.
    await admin.auth.admin.deleteUser(userId).catch(e =>
      console.error('[accept-invitation] ROLLBACK FAILED — orphaned user:', userId, e)
    )
    if (err instanceof Error && err.message === 'INVITATION_UNAVAILABLE') {
      return NextResponse.json(
        { error: 'This invitation link has reached its maximum number of uses or has expired.' },
        { status: 410 }
      )
    }
    console.error('[accept-invitation] error after auth user created:', err)
    return NextResponse.json(
      { error: 'Registration failed. Please try again or contact support.' },
      { status: 500 }
    )
  }
 } catch (outer) {
    console.error('[accept-invitation] unhandled error:', outer)
    return NextResponse.json(
      { error: 'Registration failed due to a server error. Please try again or contact support.' },
      { status: 500 }
    )
 }
}
