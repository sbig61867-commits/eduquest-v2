import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { run, maybeOne } from '@/lib/db/sql'
import { ownerCaller, ownerGate } from '@/lib/owner-gate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MODELS = 100

/** PUT { models, billedProviders } — the AI price table (platform_settings 'ai_pricing'), the owner only. */
export async function PUT(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as { models?: unknown; billedProviders?: unknown } | null
  const models = b?.models && typeof b.models === 'object' && !Array.isArray(b.models) ? b.models as Record<string, { input: unknown; output: unknown }> : null
  const entries = models ? Object.entries(models) : []
  const valid = !!models && entries.length <= MAX_MODELS && entries.every(([k, v]) =>
    /^[a-z0-9._:-]{1,80}$/i.test(k) && v && Number.isFinite(Number(v.input)) && Number(v.input) >= 0 && Number.isFinite(Number(v.output)) && Number(v.output) >= 0)
  if (!valid || !Array.isArray(b?.billedProviders)) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  const value = { models, billedProviders: b!.billedProviders }
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`insert into public.platform_settings (key, value, updated_at)
          select 'ai_pricing', ${sql.json(value as Parameters<typeof sql.json>[0])}, now() where ${ownerGate(sql, me.id)}
          on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
          returning key`,
    ])
    return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/ai PUT]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}

/** PATCH { tenant_id, ai_monthly_request_limit, ai_monthly_token_limit, ai_limit_action, ai_alert_threshold_pct } — one institution's AI limits. */
export async function PATCH(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as Record<string, unknown> | null
  const tenantId = String(b?.tenant_id ?? '')
  const req = b?.ai_monthly_request_limit ?? null
  const tok = b?.ai_monthly_token_limit ?? null
  const action = b?.ai_limit_action
  const pct = Number(b?.ai_alert_threshold_pct)
  const numOk = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1e12)
  if (!UUID.test(tenantId) || !numOk(req) || !numOk(tok) || (action !== 'block' && action !== 'warn') || !Number.isInteger(pct) || pct < 1 || pct > 100) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`update public.tenants set ai_monthly_request_limit = ${req as number | null}, ai_monthly_token_limit = ${tok as number | null},
                                 ai_limit_action = ${action}, ai_alert_threshold_pct = ${pct}
          where id = ${tenantId} and ${ownerGate(sql, me.id)} returning id`,
    ])
    return maybeOne(rows) ? NextResponse.json({ ok: true }) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/ai PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
