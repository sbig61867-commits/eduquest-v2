import { after, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/db'
import { apiErr } from '@/lib/api-error'
import { currentMeter, runMetered, summarizeAiCalls, type MeterState } from './meter'
import { DEFAULT_AI_PRICING, mergeAiPricing, type AiPricing } from './pricing'

// ── AI usage ledger + institution allowance ──────────────────────
// Route handlers that call an AI provider are wrapped in meteredAiRoute():
//
//   export const POST = meteredAiRoute('lesson', async (request: Request) => {
//     …auth…
//     const denied = await authorizeAiUsage(user.id)   // identify + monthly allowance
//     if (denied) return denied
//     …generate…
//   })
//
// Every provider call made while the handler runs is metered (src/lib/ai/meter.ts).
// When the handler returns, ONE row is written through record_ai_usage():
// success when the response is 2xx, failed otherwise, blocked when the
// institution's monthly allowance refused the request. A request that never
// reached a provider (validation error, per-user rate limit) writes nothing.
//
// The write goes through the service-role client (the ledger tables have no
// write grants for users) and runs after the response is sent, so it never
// adds latency and a logging failure can never break the AI feature itself.
// See supabase/ai_usage_metering_migration.sql.

function adminClient() {
  return getAdminDb()
}

const RPC_TIMEOUT_MS = 3_000

/** PostgREST "function not found" — the metering migration is not applied yet. */
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

// Prices change rarely; one read per minute per server instance is plenty.
const PRICING_TTL_MS = 60_000
let pricingCache: { value: AiPricing; at: number } | null = null

async function currentPricing(): Promise<AiPricing> {
  if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL_MS) return pricingCache.value
  try {
    const { data } = await adminClient()
      .from('platform_settings').select('value').eq('key', 'ai_pricing').maybeSingle()
    pricingCache = { value: mergeAiPricing(data?.value), at: Date.now() }
  } catch {
    pricingCache = { value: DEFAULT_AI_PRICING, at: Date.now() }
  }
  return pricingCache.value
}

type UsageStatus = 'success' | 'failed' | 'blocked'

// A failed ledger write is not retried: record_ai_usage has no idempotency key,
// so a retry after a lost reply could count the request twice. Instead the
// numbers (never content) are logged as `usage_lost` so they can be reconciled.
function logUsageLost(state: MeterState, status: UsageStatus, reason: string, s?: ReturnType<typeof summarizeAiCalls>): void {
  console.error('[ai-usage] usage_lost', {
    reason, feature: state.feature, status,
    providerCalls: s?.providerCalls ?? state.calls.length,
    inputTokens: s?.inputTokens, outputTokens: s?.outputTokens,
  })
}

async function persistUsage(state: MeterState, status: UsageStatus): Promise<void> {
  if (!state.userId) return
  let s: ReturnType<typeof summarizeAiCalls> | undefined
  try {
    s = summarizeAiCalls(state.calls, await currentPricing())
    const admin = adminClient()
    if (state.holdId) {
      // Reservation path: close the hold and record the request in one transaction
      // (ai_quota_finish calls record_ai_usage itself), so it is counted exactly once.
      const { data, error } = await admin.rpc('ai_quota_finish', {
        p_hold: state.holdId,
        p_user: state.userId,
        p_provider: s.provider,
        p_model: s.model,
        p_status: status,
        p_provider_calls: s.providerCalls,
        p_failed_calls: s.failedCalls,
        p_input_tokens: s.inputTokens,
        p_output_tokens: s.outputTokens,
        p_estimated: s.estimated,
        p_list_cost_usd: s.listCostUsd,
        p_billed_cost_usd: s.billedCostUsd,
        p_latency_ms: s.latencyMs,
        p_detail: s.detail,
      })
      if (error) { logUsageLost(state, status, error.code ?? 'rpc_error', s); return }
      const result = data as { ok?: unknown; error?: unknown } | null
      // EXPIRED: the hold outlived its lease and was already charged at the estimate.
      if (result?.ok !== true) logUsageLost(state, status, String(result?.error ?? 'malformed'), s)
      return
    }
    const { error } = await admin.rpc('record_ai_usage', {
      p_user: state.userId,
      p_feature: state.feature,
      p_provider: s.provider,
      p_model: s.model,
      p_status: status,
      p_provider_calls: s.providerCalls,
      p_failed_calls: s.failedCalls,
      p_input_tokens: s.inputTokens,
      p_output_tokens: s.outputTokens,
      p_estimated: s.estimated,
      p_list_cost_usd: s.listCostUsd,
      p_billed_cost_usd: s.billedCostUsd,
      p_latency_ms: s.latencyMs,
      p_detail: s.detail,
    })
    if (!error) return

    if (isMissingFunction(error)) {
      // Pre-migration: keep the original count-only log so nothing is lost.
      if (status !== 'success') return
      const { data: profile } = await admin.from('users').select('tenant_id').eq('id', state.userId).maybeSingle()
      await admin.from('ai_usage_log').insert({
        user_id: state.userId, tenant_id: profile?.tenant_id ?? null, feature: state.feature, provider: s.provider,
      })
      return
    }
    logUsageLost(state, status, error.code ?? 'rpc_error', s)
  } catch (e) {
    logUsageLost(state, status, e instanceof Error ? e.name : 'unknown', s)
  }
}

/** The request ended before any provider call: give the reserved quota back. */
async function releaseHold(state: MeterState): Promise<void> {
  if (!state.userId || !state.holdId) return
  try {
    const { error } = await adminClient().rpc('ai_quota_release', { p_hold: state.holdId, p_user: state.userId })
    // A hold that is not released expires after its lease and is charged at the estimate.
    if (error) console.error('[ai-usage] hold_release_failed', { reason: error.code ?? 'rpc_error', feature: state.feature })
  } catch (e) {
    console.error('[ai-usage] hold_release_failed', { reason: e instanceof Error ? e.name : 'unknown', feature: state.feature })
  }
}

function runAfterResponse(task: () => Promise<void>): void {
  try {
    after(task)
  } catch {
    // Outside a request scope (tests, scripts): run it now, unawaited.
    void task()
  }
}

/** Wraps an AI route handler so its provider calls are metered and logged. */
export function meteredAiRoute<A extends unknown[]>(
  feature: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const state: MeterState = { feature, userId: null, blocked: false, calls: [] }
    let response: Response | undefined
    try {
      response = await runMetered(state, () => handler(...args))
      return response
    } finally {
      if (state.holdId && state.calls.length === 0) {
        runAfterResponse(() => releaseHold(state))
      } else if (state.userId && (state.calls.length > 0 || state.blocked)) {
        const status: UsageStatus = state.blocked ? 'blocked' : response?.ok ? 'success' : 'failed'
        runAfterResponse(() => persistUsage(state, status))
      }
    }
  }
}

/** Attributes this request's AI usage to `userId` without checking the allowance. */
export function identifyAiCaller(userId: string): void {
  const state = currentMeter()
  if (state) state.userId = userId
}

export interface AiAllowance {
  allowed: boolean
  limited: boolean
  over?: boolean
  action?: 'block' | 'warn'
  requests_used?: number
  request_limit?: number | null
  tokens_used?: number
  token_limit?: number | null
}

/** Who may spend AI on whose allowance, read with the service role from the users row. */
type CallerCheck =
  | { kind: 'institution'; tenantId: string }
  | { kind: 'platform' }
  | { kind: 'denied' }
  | { kind: 'unverified' }

/**
 * Re-derives the caller from public.users, never from the request or the JWT:
 * an inactive user, a missing row, or a user without an institution who is not
 * an active super_admin is denied. A lookup error is 'unverified' (fail closed).
 */
async function checkCaller(userId: string): Promise<CallerCheck> {
  try {
    const { data, error } = await adminClient()
      .from('users').select('role, is_active, tenant_id').eq('id', userId)
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
      .maybeSingle()
    if (error) return { kind: 'unverified' }
    const row = data as { role?: unknown; is_active?: unknown; tenant_id?: unknown } | null
    if (!row || row.is_active !== true) return { kind: 'denied' }
    if (typeof row.tenant_id === 'string' && row.tenant_id) return { kind: 'institution', tenantId: row.tenant_id }
    return row.role === 'super_admin' ? { kind: 'platform' } : { kind: 'denied' }
  } catch {
    return { kind: 'unverified' }
  }
}

/**
 * Attributes this request to `userId` and checks the institution's monthly AI
 * allowance before any provider call. Returns a ready response when the request
 * must not proceed, otherwise null.
 *
 * Fails CLOSED: a lookup error, a timeout, a missing function or a malformed
 * answer denies the request (503) — nothing is sent to a provider on doubt.
 * `warn` mode keeps its meaning: the institution is over its limit but the
 * request is allowed (check_ai_allowance returns allowed=true).
 *
 * Not atomic: concurrent requests can all pass the last unit of the allowance,
 * because usage is written after the response. Closing that needs the
 * reservation design in AI_HARDENING_PROGRESS.md (SQL, needs separate approval).
 */
export async function authorizeAiUsage(userId: string): Promise<Response | null> {
  identifyAiCaller(userId)
  const unverified = async () => NextResponse.json(
    { ...(await apiErr('aiUnavailable')) },
    { status: 503, headers: { 'Retry-After': '30' } },
  )
  const forbidden = async () => NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const caller = await checkCaller(userId)
  if (caller.kind === 'unverified') {
    console.error('[ai-usage] allowance unverified:', 'caller_lookup')
    return unverified()
  }
  if (caller.kind === 'denied') return forbidden()
  // The platform owner has no institution and no allowance to check.
  if (caller.kind === 'platform') return null

  if (quotaReservationsEnabled()) return reserveQuota(userId, unverified, forbidden)

  try {
    const { data, error } = await adminClient()
      .rpc('check_ai_allowance', { p_user: userId })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
    if (error) {
      console.error('[ai-usage] allowance unverified:', isMissingFunction(error) ? 'migration_missing' : (error.code ?? 'rpc_error'))
      return unverified()
    }
    const allowance = data as (AiAllowance & { tenant_id?: unknown }) | null
    if (!allowance || typeof allowance.allowed !== 'boolean') {
      console.error('[ai-usage] allowance unverified:', 'malformed_response')
      return unverified()
    }
    // The function must have checked the same institution the users row names.
    if (allowance.tenant_id !== undefined && allowance.tenant_id !== caller.tenantId) {
      console.error('[ai-usage] allowance unverified:', 'tenant_mismatch')
      return unverified()
    }
    if (allowance.allowed) return null

    const state = currentMeter()
    if (state) state.blocked = true
    return NextResponse.json({ ...(await apiErr('aiInstitutionLimitReached')) }, { status: 429 })
  } catch (e) {
    console.error('[ai-usage] allowance unverified:', e instanceof Error ? e.name : 'unknown')
    return unverified()
  }
}

// ── Atomic quota reservation (scratch-reserve/ai_quota_reservations_v3_DRAFT.sql) ──
// Off unless AI_QUOTA_RESERVATIONS=on. The SQL functions must be applied first;
// until then the flag stays off and the allowance check above is used.

/** True only when the reservation functions are deployed and the flag is set. */
export function quotaReservationsEnabled(): boolean {
  return process.env.AI_QUOTA_RESERVATIONS === 'on'
}

/** Conservative per-request token estimates held against the monthly allowance
 *  until the request is recorded. Provisional: to be replaced by measured usage. */
const RESERVATION_ESTIMATES: Record<string, { in: number; out: number }> = {
  'lesson-from-file': { in: 60_000, out: 40_000 },
  'homework-from-file': { in: 30_000, out: 20_000 },
}
const DEFAULT_RESERVATION = { in: 6_000, out: 4_096 }
/** Longest route budget (300 s) plus margin; a hold not closed by then is charged at the estimate. */
const RESERVATION_LEASE_SECONDS = 330

async function reserveQuota(
  userId: string,
  unverified: () => Promise<Response>,
  forbidden: () => Promise<Response>,
): Promise<Response | null> {
  const state = currentMeter()
  const feature = state?.feature ?? 'unknown'
  const est = RESERVATION_ESTIMATES[feature] ?? DEFAULT_RESERVATION
  try {
    const { data, error } = await adminClient()
      .rpc('ai_quota_reserve', {
        p_user: userId, p_feature: feature, p_est_in: est.in, p_est_out: est.out,
        p_lease_seconds: RESERVATION_LEASE_SECONDS,
      })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
    if (error) {
      console.error('[ai-usage] reservation unverified:', isMissingFunction(error) ? 'migration_missing' : (error.code ?? 'rpc_error'))
      return unverified()
    }
    const r = data as { ok?: unknown; hold_id?: unknown; error?: unknown } | null
    if (r?.ok === true && typeof r.hold_id === 'string') {
      if (state) state.holdId = r.hold_id
      return null
    }
    if (r?.error === 'QUOTA_REQUESTS' || r?.error === 'QUOTA_TOKENS') {
      if (state) state.blocked = true
      return NextResponse.json({ ...(await apiErr('aiInstitutionLimitReached')) }, { status: 429 })
    }
    if (r?.error === 'USER_INACTIVE' || r?.error === 'UNKNOWN_USER' || r?.error === 'NO_TENANT') return forbidden()
    console.error('[ai-usage] reservation unverified:', 'malformed_response')
    return unverified()
  } catch (e) {
    console.error('[ai-usage] reservation unverified:', e instanceof Error ? e.name : 'unknown')
    return unverified()
  }
}
