import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ── PATCH /api/invitations/[id] ──────────────────────────────
// Revokes a pending invitation. Only the creator or a higher-role
// admin in the same tenant can revoke.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!caller) return NextResponse.json({ error: 'Profile not found' }, { status: 403 })

  // Fetch the invitation to check ownership and current state
  const { data: invitation } = await supabase
    .from('invitations').select('*').eq('id', id).single()

  if (!invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  if (invitation.status !== 'pending') {
    return NextResponse.json(
      { error: `Cannot revoke an invitation with status: ${invitation.status}` },
      { status: 409 }
    )
  }

  // Authorization: must be the creator, or a university_admin in the same tenant, or super_admin
  const canRevoke =
    caller.role === 'super_admin' ||
    invitation.invited_by === user.id ||
    (caller.role === 'university_admin' && invitation.tenant_id === caller.tenant_id)

  if (!canRevoke) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', id)
    .eq('status', 'pending') // extra guard against race

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
