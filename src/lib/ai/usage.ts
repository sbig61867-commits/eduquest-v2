import { after, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
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

async function persistUsage(state: MeterState, status: UsageStatus): Promise<void> {
  if (!state.userId) return
  try {
    const s = summarizeAiCalls(state.calls, await currentPricing())
    const admin = adminClient()
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
    console.error('[ai-usage] record failed:', error.message)
  } catch (e) {
    console.error('[ai-usage] record failed:', e instanceof Error ? e.message : e)
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
      if (state.userId && (state.calls.length > 0 || state.blocked)) {
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

/**
 * Attributes this request to `userId` and checks the institution's monthly AI
 * allowance. Returns a ready 429 response when the institution is over its
 * limit in `block` mode, otherwise null. Fails OPEN (like rateLimit) when the
 * check itself errors or the migration is not applied yet — an allowance is a
 * commercial limit, not a security boundary.
 */
export async function authorizeAiUsage(userId: string): Promise<Response | null> {
  identifyAiCaller(userId)
  try {
    const { data, error } = await adminClient()
      .rpc('check_ai_allowance', { p_user: userId })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
    if (error) {
      if (!isMissingFunction(error)) console.error('[ai-usage] allowance check failed:', error.message)
      return null
    }
    const allowance = data as AiAllowance | null
    if (!allowance || allowance.allowed) return null

    const state = currentMeter()
    if (state) state.blocked = true
    return NextResponse.json({ ...(await apiErr('aiInstitutionLimitReached')) }, { status: 429 })
  } catch (e) {
    console.error('[ai-usage] allowance check failed:', e instanceof Error ? e.message : e)
    return null
  }
}
