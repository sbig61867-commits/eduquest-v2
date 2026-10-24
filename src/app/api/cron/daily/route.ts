import { NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron-secret'
import { run, maybeOne } from '@/lib/db/sql'

// POST /api/cron/daily — the platform's daily jobs (step 12: pg_cron →
// Cloudflare Cron Triggers). worker.ts calls it from its `scheduled` handler at
// 02:00 UTC (wrangler.jsonc → triggers.crons) with `Authorization: Bearer
// <CRON_SECRET>`; public in src/proxy.ts (no user session) — the secret
// (compared via timingSafeEqual) is the only gate.
//
// Jobs: delete pending invitations that expired more than 30 days ago
// (public.cleanup_expired_invitations, app_system only — neon/migrations/0010).
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const [rows] = await run({ as: 'system' }, sql => [sql`select public.cleanup_expired_invitations() as deleted`])
    const deleted = maybeOne<{ deleted: number }>(rows)?.deleted ?? 0
    return NextResponse.json({ ok: true, expiredInvitationsDeleted: deleted })
  } catch (e) {
    console.error('[cron/daily]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
