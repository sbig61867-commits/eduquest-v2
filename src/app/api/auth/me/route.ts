import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentCtx } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'

// GET /api/auth/me — the signed-in user's role and member ID, for client pages
// that used to read them from the browser (change-password). Own row only, as
// that user (RLS).
export async function GET() {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const [rows] = await run({ as: 'user', userId: ctx.sub }, sql => [
    sql`select role, member_code from public.users where id = ${ctx.sub}`,
  ])
  const me = maybeOne<{ role: string | null; member_code: string | null }>(rows)
  return NextResponse.json({ role: me?.role ?? null, memberCode: me?.member_code ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}
