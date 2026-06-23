import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendInvitationEmail } from '@/lib/email'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Role ceiling: what roles each caller can invite
const ROLE_CEILING: Record<string, string[]> = {
  super_admin:      ['university_admin', 'teacher', 'student'],
  university_admin: ['teacher', 'student'],
  teacher:          ['student'],
}

// Default expiry durations in hours
const DEFAULT_EXPIRY_HOURS: Record<string, number> = {
  university_admin: 72,  // 3 days
  teacher:          48,  // 2 days
  student:          168, // 7 days
}

// ── GET /api/invitations ─────────────────────────────────────
// Returns all invitations visible to the current user.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 403 })

  let query = supabase
    .from('invitations')
    .select(`
      *,
      tenants(name),
      groups(name),
      inviter:invited_by(full_name, email)
    `)
    .order('created_at', { ascending: false })

  // Scope: super_admin sees all, others only see their tenant's invitations
  if (profile.role !== 'super_admin') {
    query = query.eq('tenant_id', profile.tenant_id)
  }

  // Teachers only see invitations they created
  if (profile.role === 'teacher') {
    query = query.eq('invited_by', user.id)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ invitations: data ?? [] })
}

// ── POST /api/invitations ────────────────────────────────────
// Creates a new invitation. Sends back the invitation URL.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!caller) return NextResponse.json({ error: 'Profile not found' }, { status: 403 })

  if (!ROLE_CEILING[caller.role]) {
    return NextResponse.json({ error: 'You cannot create invitations' }, { status: 403 })
  }

  let body: {
    email?: string
    role?: string
    tenant_id?: string
    group_id?: string
    expires_hours?: number
    is_public?: boolean
    max_uses?: number
  }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { email, role, group_id, expires_hours } = body
  const isPublic = body.is_public === true
  const maxUses  = body.max_uses ? Number(body.max_uses) : null
  let groupNameSnapshot: string | null = null

  // ── Validate role ────────────────────────────────────────
  if (!role) {
    return NextResponse.json({ error: 'role is required' }, { status: 400 })
  }
  if (!ROLE_CEILING[caller.role].includes(role)) {
    return NextResponse.json(
      { error: `Your role (${caller.role}) cannot invite a ${role}` },
      { status: 403 }
    )
  }

  // ── Public link rules ────────────────────────────────────
  // super_admin → university_admin must ALWAYS be email-specific (high privilege)
  if (isPublic && caller.role === 'super_admin' && role === 'university_admin') {
    return NextResponse.json(
      { error: 'University Admin invitations must always be email-specific for security.' },
      { status: 400 }
    )
  }

  // ── Email validation ─────────────────────────────────────
  if (!isPublic) {
    if (!email?.trim()) {
      return NextResponse.json({ error: 'email is required for private invitations' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }
  }

  // ── Resolve tenant_id ────────────────────────────────────
  const tenant_id = caller.role === 'super_admin'
    ? (body.tenant_id ?? null)
    : caller.tenant_id

  if (!tenant_id) {
    return NextResponse.json({ error: 'tenant_id is required for this role' }, { status: 400 })
  }

  // Verify tenant exists and is active
  if (caller.role === 'super_admin') {
    const { data: tenant } = await supabase.from('tenants').select('id, is_active').eq('id', tenant_id).single()
    if (!tenant) return NextResponse.json({ error: 'University not found' }, { status: 404 })
    if (!tenant.is_active) return NextResponse.json({ error: 'This university is currently suspended' }, { status: 403 })
  }

  // ── Validate group_id if provided ───────────────────────
  if (group_id) {
    if (role !== 'student') {
      return NextResponse.json({ error: 'group_id is only valid for student invitations' }, { status: 400 })
    }
    const { data: group } = await supabase
      .from('groups').select('id, name, teacher_id, tenant_id').eq('id', group_id).single()

    if (!group || group.tenant_id !== tenant_id) {
      return NextResponse.json({ error: 'Group not found in this tenant' }, { status: 400 })
    }
    // Teachers can only invite to their own groups
    if (caller.role === 'teacher' && group.teacher_id !== user.id) {
      return NextResponse.json({ error: 'You can only invite students to your own groups' }, { status: 403 })
    }
    groupNameSnapshot = group.name
  }

  const adminClient = getAdminClient()

  // ── Email duplicate checks (private invitations only) ────
  if (!isPublic && email) {
    const trimmedEmail = email.trim().toLowerCase()

    const { data: existingUser } = await supabase
      .from('users').select('id, tenant_id').eq('email', trimmedEmail).single()

    if (existingUser) {
      if (existingUser.tenant_id === tenant_id) {
        return NextResponse.json({ error: 'A user with this email already exists in this university' }, { status: 409 })
      }
      return NextResponse.json(
        { error: 'This email is already registered in another university. Contact support to transfer.' },
        { status: 409 }
      )
    }

    const { data: authExists, error: authCheckError } = await adminClient
      .rpc('check_email_in_auth', { p_email: trimmedEmail })

    if (!authCheckError && authExists) {
      return NextResponse.json(
        { error: 'This email is already registered. If you lost access to your account, contact support.' },
        { status: 409 }
      )
    }
  }

  // ── Compute expiry ───────────────────────────────────────
  const hours = Math.min(Math.max(expires_hours ?? DEFAULT_EXPIRY_HOURS[role], 1), 720)
  const expires_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()

  // ── Insert ───────────────────────────────────────────────
  const { data: invitation, error: insertError } = await adminClient
    .from('invitations')
    .insert({
      email:               isPublic ? null : email!.trim().toLowerCase(),
      role,
      tenant_id,
      group_id:            group_id ?? null,
      group_name_snapshot: groupNameSnapshot,
      invited_by:          user.id,
      expires_at,
      is_public:           isPublic,
      max_uses:            isPublic ? maxUses : null,
    })
    .select('*')
    .single()

  if (insertError) {
    // Unique constraint violation = pending invitation already exists for this email+tenant
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'A pending invitation for this email already exists. Revoke it first to create a new one.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const joinUrl = `${baseUrl}/join/${invitation.token}`

  // Send invitation email (private links only — public links are shared manually)
  if (!isPublic && invitation.email) {
    const { data: inviterProfile } = await supabase
      .from('users').select('full_name').eq('id', user.id).single()

    const { data: tenant } = await supabase
      .from('tenants').select('name').eq('id', tenant_id).single()

    sendInvitationEmail({
      to:          invitation.email,
      role,
      tenantName:  tenant?.name ?? 'your university',
      joinUrl,
      expiresAt:   invitation.expires_at,
      inviterName: inviterProfile?.full_name ?? undefined,
    }).catch(err => console.error('[email] Failed to send invitation email:', err))
  }

  return NextResponse.json({ invitation, joinUrl }, { status: 201 })
}
