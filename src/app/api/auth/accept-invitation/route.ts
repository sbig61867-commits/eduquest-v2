import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── POST /api/auth/accept-invitation ────────────────────────
// Called from the /join/[token] page when the user submits the form.
//
// Flow:
//  1. Validate token via get_invitation_by_token() RPC (read-only, no auth required)
//  2. Verify email matches what the user typed
//  3. Create auth.users entry (service role, bypasses email confirmation)
//  4. Call accept_invitation() RPC — atomically consumes token + sets role + tenant
//  5. If RPC fails (race condition: token already used), delete the auth user (rollback)
//  6. Return { email } so the client can sign in with signInWithPassword
export async function POST(request: Request) {
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }

  const adminClient = getAdminClient()

  // ── Step 1: validate token ────────────────────────────────
  const { data: invData, error: invError } = await adminClient
    .rpc('get_invitation_by_token', { p_token: token })

  if (invError || !invData) {
    return NextResponse.json({ error: 'This invitation link is invalid or has expired.' }, { status: 410 })
  }

  // ── Step 2: verify email (private invitations only) ───────
  // Public invitations accept any email; private are locked to the invited address.
  if (!invData.is_public) {
    if (!invData.email || invData.email.toLowerCase() !== email.trim().toLowerCase()) {
      return NextResponse.json(
        { error: 'The email address does not match this invitation.' },
        { status: 403 }
      )
    }
  }

  // ── Step 3: create auth user ──────────────────────────────
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true, // skip email verification — invitation already confirmed the email
    user_metadata: { full_name: fullName.trim() },
  })

  if (authError) {
    // Most likely: email already registered
    if (authError.message?.includes('already registered') || authError.status === 422) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try logging in instead.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const newUserId = authData.user.id

  // ── Step 4: atomically accept invitation + set role/tenant ──
  const { error: rpcError } = await adminClient
    .rpc('accept_invitation', {
      p_token:     token,
      p_user_id:   newUserId,
      p_full_name: fullName.trim(),
    })

  if (rpcError) {
    // Step 5: rollback — delete the auth user we just created
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(newUserId)
    if (deleteError) {
      // Orphaned user in auth.users — must be cleaned up manually
      console.error('[accept-invitation] ROLLBACK FAILED — orphaned auth user:', {
        userId: newUserId,
        email: email.trim().toLowerCase(),
        deleteError: deleteError.message,
      })
      return NextResponse.json(
        { error: 'Registration incomplete due to a server error. Please contact support with your email address.' },
        { status: 500 }
      )
    }

    // Distinguish "token already consumed" from other DB errors
    if (rpcError.message?.includes('INVITATION_INVALID_OR_EXPIRED')) {
      return NextResponse.json(
        { error: 'This invitation was already used or has expired. Request a new one.' },
        { status: 410 }
      )
    }
    console.error('[accept-invitation] RPC error:', rpcError)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }

  // ── Step 6: return email so client can sign in ────────────
  return NextResponse.json({ email: email.trim().toLowerCase() })
}
