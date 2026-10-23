import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── PATCH /api/invitations/[id] ──────────────────────────────
// Revokes a pending invitation. Only the creator, a university_admin in the
// same tenant, or super_admin. One unit, pinned to the caller's institution
// (the owner: platform scope): the invitation as it stands (for a precise
// refusal), then the revoke — only while it is pending (race guard) and the
// caller, checked live, may revoke it.
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const scope = ctx.role === 'super_admin'
    ? { as: 'service', platform: true } as const
    : ctx.tenant_id ? { as: 'service', tenantId: ctx.tenant_id } as const : null
  if (!scope) return NextResponse.json({ ...(await apiErr('profileNotFound')) }, { status: 403 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('invitationNotFound')) }, { status: 404 })

  let invitation: { status: string; invited_by: string | null; tenant_id: string } | null
  let revoked: unknown
  try {
    const [found, done] = await run(scope, sql => [
      sql`select status, invited_by, tenant_id from public.invitations where id = ${id}`,
      sql`update public.invitations i set status = 'revoked'
            from public.users me
           where i.id = ${id} and i.status = 'pending'
             and me.id = ${ctx.sub} and me.is_active is not false
             and (me.role = 'super_admin'
                  or i.invited_by = me.id
                  or (me.role = 'university_admin' and i.tenant_id = me.tenant_id))
          returning i.id`,
    ])
    invitation = maybeOne(found)
    revoked = maybeOne(done)
  } catch (e) {
    console.error('[invitations/revoke]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('invitationRevokeFailed')) }, { status: 500 })
  }
  if (revoked) return NextResponse.json({ ok: true })

  // Nothing was written: say why.
  if (!invitation) return NextResponse.json({ ...(await apiErr('invitationNotFound')) }, { status: 404 })
  if (invitation.status !== 'pending') {
    return NextResponse.json({ error: `Cannot revoke an invitation with status: ${invitation.status}` }, { status: 409 })
  }
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}
