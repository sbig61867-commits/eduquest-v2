import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { run } from '@/lib/db/sql'
import { ownerCaller, ownerGate } from '@/lib/owner-gate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PATCH { id, is_read: true } — mark one contact message read (the owner only). */
export async function PATCH(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as { id?: unknown; is_read?: unknown } | null
  const id = String(b?.id ?? '')
  if (!UUID.test(id) || b?.is_read !== true) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`update public.contact_messages set is_read = true where id = ${id} and ${ownerGate(sql, me.id)} returning id`,
    ])
    return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/messages PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}

/** DELETE ?id= — remove one contact message (the owner only). */
export async function DELETE(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`delete from public.contact_messages where id = ${id} and ${ownerGate(sql, me.id)} returning id`,
    ])
    return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/messages DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
