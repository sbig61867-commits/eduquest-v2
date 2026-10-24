import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentCtx } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'

// GET /api/auth/profile — the signed-in user's own row and their institution,
// for the client account store (components/shared/auth-provider.tsx). Read as
// that user (RLS): exactly the row the browser could read for itself before
// step 9 (users_select: own row; tenants_select: own institution). One statement.
export async function GET() {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const [rows] = await run({ as: 'user', userId: ctx.sub }, sql => [
    sql`select to_jsonb(u) as user, to_jsonb(t) as tenant
          from public.users u left join public.tenants t on t.id = u.tenant_id
         where u.id = ${ctx.sub}`,
  ])
  const r = maybeOne<{ user: Record<string, unknown>; tenant: Record<string, unknown> | null }>(rows)
  if (!r) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  return NextResponse.json({ user: r.user, tenant: r.tenant }, { headers: { 'Cache-Control': 'private, no-store' } })
}
