import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Row } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/requests/messages — append a message to a request thread.
// One unit, as app_service pinned to the caller's institution: the request
// (for a precise refusal), the message — written only by a participant or an
// admin of that institution, checked live — and the bump of the request so
// the inbox re-sorts by latest activity.
export async function POST(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id

  let body: { request_id?: string; body?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { request_id, body: text } = body
  if (!request_id) return NextResponse.json({ ...(await apiErr('missingRequestId')) }, { status: 400 })
  if (!text?.trim()) return NextResponse.json({ ...(await apiErr('messageEmpty')) }, { status: 400 })
  if (!UUID.test(request_id)) return NextResponse.json({ ...(await apiErr('requestNotFound')) }, { status: 404 })

  let rows: Row[][]
  try {
    rows = await run({ as: 'service', tenantId }, sql => [
      sql`select id from public.staff_requests where id = ${request_id} and tenant_id = ${tenantId}`,
      sql`insert into public.request_messages (request_id, sender_id, body)
          select r.id, me.id, ${text.trim()} from public.staff_requests r, public.users me
           where r.id = ${request_id} and r.tenant_id = ${tenantId}
             and me.id = ${user.id} and me.tenant_id = ${tenantId} and me.is_active is not false
             and (r.from_user_id = me.id or r.to_user_id = me.id or me.role in ('university_admin', 'super_admin'))
          returning id, body, sender_id, created_at`,
      sql`update public.staff_requests set updated_at = now()
           where id = ${request_id} and tenant_id = ${tenantId}
             and exists (select 1 from public.request_messages m where m.request_id = ${request_id} and m.sender_id = ${user.id}
                           and m.created_at = now())  -- the message this transaction just wrote`,
    ])
  } catch (e) {
    console.error('[api/requests/messages POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('messageSendFailed')) }, { status: 500 })
  }

  const created = maybeOne(rows[1])
  if (created) return NextResponse.json(created, { status: 201 })
  if (!maybeOne(rows[0])) return NextResponse.json({ ...(await apiErr('requestNotFound')) }, { status: 404 })
  return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
}
