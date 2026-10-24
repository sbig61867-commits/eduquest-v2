import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { run, maybeOne } from '@/lib/db/sql'
import { ownerCaller } from '@/lib/owner-gate'

/** PATCH { full_name } — the owner's own display name (their own row only). */
export async function PATCH(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as { full_name?: unknown } | null
  const name = typeof b?.full_name === 'string' ? b.full_name.trim() : ''
  if (!name || name.length > 200) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`update public.users set full_name = ${name} where id = ${me.id} returning full_name`,
    ])
    const row = maybeOne<{ full_name: string }>(rows)
    return row ? NextResponse.json(row) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/profile PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
