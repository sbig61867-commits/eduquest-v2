import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'

// Staff request/inbox channel between a teacher and their university_admin.
// Each call is ONE unit as app_service pinned to the caller's institution:
// side reads for a precise refusal, and the write itself, which re-checks the
// caller's live row and every rule in the same statement.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQUEST_TYPES = ['grade_sheet', 'report', 'general'] as const
const STATUSES = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'] as const

// State machine: which transitions are valid and who may make them.
// sender  = from_user_id  (teacher who opened the request)
// recipient = to_user_id  (admin)
const ALLOWED_TRANSITIONS: Record<string, { allowedBy: 'sender' | 'recipient' | 'either'; from: string[] }> = {
  cancelled:  { allowedBy: 'sender',    from: ['pending', 'accepted'] },
  accepted:   { allowedBy: 'recipient', from: ['pending'] },
  rejected:   { allowedBy: 'recipient', from: ['pending'] },
  completed:  { allowedBy: 'either',    from: ['accepted'] },
}

// POST /api/requests — create a request (+ optional first message)
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id || !['teacher', 'university_admin'].includes(ctx.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const tenantId = ctx.tenant_id

  let body: { to_user_id?: string; type?: string; subject?: string; group_id?: string; message?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { to_user_id, type = 'general', subject, group_id, message } = body
  if (!to_user_id) return NextResponse.json({ ...(await apiErr('recipientRequiredOne')) }, { status: 400 })
  if (!subject?.trim()) return NextResponse.json({ ...(await apiErr('subjectRequired')) }, { status: 400 })
  if (!REQUEST_TYPES.includes(type as typeof REQUEST_TYPES[number])) {
    return NextResponse.json({ ...(await apiErr('invalidRequestType')) }, { status: 400 })
  }
  if (to_user_id === user.id) return NextResponse.json({ ...(await apiErr('cannotRequestSelf')) }, { status: 400 })
  if (!UUID.test(to_user_id)) return NextResponse.json({ ...(await apiErr('recipientNotInTenant')) }, { status: 404 })
  if (group_id && !UUID.test(group_id)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })

  // One unit:
  //  1-3. the caller (live), the recipient and the group as they stand
  //  4. the request — written ONLY when the recipient is staff of this
  //     institution in the allowed direction (teacher ↔ university_admin),
  //     and an attached group is this institution's (a teacher's own)
  //  5. the first message, only if the request was written
  // The id is chosen here so the message can name it.
  const requestId = crypto.randomUUID()
  const text = message?.trim() || null
  let rows: Row[][]
  try {
    rows = await run({ as: 'service', tenantId }, sql => [
      sql`select role from public.users where id = ${user.id} and tenant_id = ${tenantId} and is_active is not false`,
      sql`select role from public.users where id = ${to_user_id} and tenant_id = ${tenantId}`,
      sql`select teacher_id from public.groups where id = ${group_id ?? null}::uuid and tenant_id = ${tenantId}`,
      sql`insert into public.staff_requests (id, tenant_id, from_user_id, to_user_id, type, subject, group_id, status)
          select ${requestId}, ${tenantId}, me.id, r.id, ${type}, ${subject.trim()}, ${group_id ?? null}, 'pending'
            from public.users me, public.users r
           where me.id = ${user.id} and me.tenant_id = ${tenantId} and me.is_active is not false
             and me.role in ('teacher', 'university_admin')
             and r.id = ${to_user_id} and r.tenant_id = ${tenantId}
             and r.role = case me.role when 'teacher' then 'university_admin' else 'teacher' end
             and (${group_id ?? null}::uuid is null or exists (
                   select 1 from public.groups g where g.id = ${group_id ?? null}::uuid and g.tenant_id = ${tenantId}
                      and (me.role <> 'teacher' or g.teacher_id = me.id)))
          returning id`,
      ...(text ? [
        sql`insert into public.request_messages (request_id, sender_id, body)
            select id, ${user.id}, ${text} from public.staff_requests where id = ${requestId}`,
      ] : []),
    ])
  } catch (e) {
    console.error('[api/requests POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('requestCreateFailed')) }, { status: 500 })
  }

  if (maybeOne(rows[3])) return NextResponse.json({ id: requestId }, { status: 201 })

  // Nothing was written: say why.
  const me = maybeOne<{ role: string }>(rows[0])
  if (!me) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const recipient = maybeOne<{ role: string }>(rows[1])
  if (!recipient) return NextResponse.json({ ...(await apiErr('recipientNotInTenant')) }, { status: 404 })
  if (recipient.role !== (me.role === 'teacher' ? 'university_admin' : 'teacher')) {
    return NextResponse.json({ ...(await apiErr('requestTargetNotAllowed')) }, { status: 403 })
  }
  if (group_id) {
    const group = maybeOne<{ teacher_id: string }>(rows[2])
    if (!group) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
    if (me.role === 'teacher' && group.teacher_id !== user.id) {
      return NextResponse.json({ ...(await apiErr('notYourGroup')) }, { status: 403 })
    }
  }
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}

// PATCH /api/requests — change status (accept/reject/complete/cancel)
export async function PATCH(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id

  let body: { id?: string; status?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { id, status } = body
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })
  if (!status || !STATUSES.includes(status as typeof STATUSES[number])) {
    return NextResponse.json({ ...(await apiErr('invalidStatus')) }, { status: 400 })
  }
  // Validate the state machine: a status nobody may set is refused up front.
  const transition = ALLOWED_TRANSITIONS[status]
  if (!transition) return NextResponse.json({ ...(await apiErr('transitionNotAllowed')) }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('requestNotFound')) }, { status: 404 })

  // One unit: the request and the caller as they stand (for a precise
  // refusal), then the update — only from a valid state, by the party the
  // transition belongs to (super_admin may make any), the caller live.
  let rows: Row[][]
  try {
    rows = await run({ as: 'service', tenantId }, sql => [
      sql`select from_user_id, to_user_id, status from public.staff_requests where id = ${id} and tenant_id = ${tenantId}`,
      sql`select role from public.users where id = ${user.id} and tenant_id = ${tenantId} and is_active is not false`,
      sql`update public.staff_requests r set status = ${status}, updated_at = now()
            from public.users me
           where r.id = ${id} and r.tenant_id = ${tenantId}
             and r.status in (select jsonb_array_elements_text(${sql.json(transition.from)}))
             and me.id = ${user.id} and me.tenant_id = ${tenantId} and me.is_active is not false
             and (me.role = 'super_admin'
                  or (${transition.allowedBy} = 'sender' and r.from_user_id = me.id)
                  or (${transition.allowedBy} = 'recipient' and r.to_user_id = me.id)
                  or (${transition.allowedBy} = 'either' and (r.from_user_id = me.id or r.to_user_id = me.id
                                                                or me.role = 'university_admin')))
          returning r.id`,
    ])
  } catch (e) {
    console.error('[api/requests PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('statusUpdateFailed')) }, { status: 500 })
  }
  if (maybeOne(rows[2])) return NextResponse.json({ success: true, status })

  // Nothing was written: say why.
  const req = maybeOne<{ from_user_id: string; to_user_id: string; status: string }>(rows[0])
  if (!req) return NextResponse.json({ ...(await apiErr('requestNotFound')) }, { status: 404 })
  const me = maybeOne<{ role: string }>(rows[1])
  const isParticipant = req.from_user_id === user.id || req.to_user_id === user.id
  if (!me || (!isParticipant && me.role !== 'university_admin' && me.role !== 'super_admin')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (!transition.from.includes(req.status)) {
    return NextResponse.json({ ...(await apiErr('badTransition', { from: req.status, to: status })) }, { status: 409 })
  }
  return NextResponse.json({ ...(await apiErr('requestActionForbidden')) }, { status: 403 })
}
