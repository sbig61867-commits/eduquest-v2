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
    if (authError.message?.toLowerCase().includes('already') || authError.status === 422) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try logging in instead.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const userId = authData.user.id

  try {
    // ── Step 4: create user profile ───────────────────────────
    const { error: profileErr } = await admin.from('users').upsert({
      id:        userId,
      email:     cleanEmail,
      full_name: fullName.trim(),
      role:      inv.role,
      tenant_id: inv.tenant_id,
      is_active: true,
    }, { onConflict: 'id' })

    if (profileErr) throw new Error(`Profile: ${profileErr.message}`)

    // ── Step 5: mark invitation as used ──────────────────────
    if (inv.is_public) {
      const newCount = (inv.use_count ?? 0) + 1
      const newStatus = inv.max_uses != null && newCount >= inv.max_uses ? 'revoked' : 'pending'
      await admin.from('invitations').update({
        use_count: newCount,
        status: newStatus,
      }).eq('id', inv.id)
    } else {
      await admin.from('invitations').update({
        status:      'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      }).eq('id', inv.id)
    }

    // ── Step 6: enroll in group (student only) ───────────────
    if (inv.group_id && inv.role === 'student') {
      await admin.from('group_students')
        .upsert({ group_id: inv.group_id, student_id: userId }, { onConflict: 'group_id,student_id', ignoreDuplicates: true })
    }

    // ── Step 7: enroll in course (student only) ──────────────
    if (inv.course_id && inv.role === 'student') {
      await admin.from('course_enrollments')
        .upsert({
          course_id: inv.course_id,
          student_id: userId,
          tenant_id: inv.tenant_id,
        }, { onConflict: 'course_id,student_id', ignoreDuplicates: true })
    }

    return NextResponse.json({ email: cleanEmail })

  } catch (err) {
    // Rollback: delete the auth user so the email can be used again
    await admin.auth.admin.deleteUser(userId).catch(e =>
      console.error('[accept-invitation] ROLLBACK FAILED — orphaned user:', userId, e)
    )
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[accept-invitation] error after auth user created:', detail)
    return NextResponse.json(
      { error: 'Registration failed. Please try again or contact support.' },
      { status: 500 }
    )
  }
}
