import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'

const PAGE_SIZE = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx || ctx.role !== 'super_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const tenantId = searchParams.get('tenant_id')
  const role     = searchParams.get('role') || null
  const search   = searchParams.get('search') ?? ''
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)

  if (!tenantId) return NextResponse.json({ ...(await apiErr('tenantIdRequired')) }, { status: 400 })
  if (!UUID.test(tenantId)) return NextResponse.json({ users: [], total: 0, page, pageSize: PAGE_SIZE })

  // The search is a bound parameter (no filter string to inject into); the
  // LIKE wildcards are still stripped so a lone `%` cannot match everyone.
  const safe = search.replace(/[%\\*_]/g, ' ').trim().slice(0, 100)
  const pattern = safe ? `%${safe}%` : null
  const from = (page - 1) * PAGE_SIZE

  // One statement, read as the owner (RLS: super_admin sees every account):
  // exactly the fields the owner's users table reads (users-client.tsx `User`)
  // and the total of the filtered set.
  try {
    const [rows] = await run({ as: 'user', userId: ctx.sub }, sql => [
      sql`select id, full_name, email, role, is_active, created_at, tenant_id, member_code, count(*) over () as total
            from public.users
           where tenant_id = ${tenantId}
             and (${role}::text is null or role = ${role}::text)
             and (${pattern}::text is null or full_name ilike ${pattern}::text or email ilike ${pattern}::text)
           order by created_at desc
           limit ${PAGE_SIZE} offset ${from}`,
    ])
    const list = rows as unknown as ({ total: number | string } & Record<string, unknown>)[]
    const total = list.length ? Number(list[0].total) : 0
    return NextResponse.json({ users: list.map(({ total: _t, ...u }) => (void _t, u)), total, page, pageSize: PAGE_SIZE })
  } catch (e) {
    console.error('[tenant-users]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('usersLoadFailed')) }, { status: 500 })
  }
}
