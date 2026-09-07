// Persistent rate limiter — backed by the Postgres `rate_limits` table via the
// atomic `check_rate_limit` RPC. Survives serverless cold starts and works across
// multiple instances (unlike an in-memory Map, which resets per process).
import { createClient as createAdminClient } from '@supabase/supabase-js'

interface RateLimitOptions {
  /** Max requests allowed in the window */
  limit: number
  /** Window duration in seconds */
  windowSecs: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// R-2 Layer 1: the RPC call itself previously had no timeout — a hung DB
// connection could hold a request open far longer than the rate-limit
// decision is worth waiting for. Bounding this also means a stuck dependency
// is detected quickly instead of slowly, which matters for Layer 2 below.
const RATE_LIMIT_RPC_TIMEOUT_MS = 3_000

function fallbackAllow(opts: RateLimitOptions): RateLimitResult {
  return { allowed: true, remaining: opts.limit, resetAt: Date.now() + opts.windowSecs * 1000 }
}

export async function rateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const { data, error } = await adminClient()
    .rpc('check_rate_limit', { p_key: key, p_limit: opts.limit, p_window_secs: opts.windowSecs })
    .abortSignal(AbortSignal.timeout(RATE_LIMIT_RPC_TIMEOUT_MS))

  // Fail-open: if the limiter itself errors, do not block legitimate traffic.
  // This is deliberate for cheap/session endpoints (login, dashboards) — see
  // aiRateLimit() below for the bounded-fail-closed variant used by expensive
  // AI endpoints, which must NOT inherit unlimited fail-open behavior.
  if (error || !data) {
    return fallbackAllow(opts)
  }

  const row = data as Record<string, unknown>
  if (
    typeof row.allowed !== 'boolean' ||
    typeof row.remaining !== 'number' ||
    typeof row.reset_at !== 'string'
  ) {
    return fallbackAllow(opts)
  }
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: new Date(row.reset_at).getTime(),
  }
}

// ── R-2 Layer 2: bounded emergency circuit breaker for AI endpoints ────────
//
// Problem: rateLimit() fails open, so a sustained rate-limit-dependency
// outage means unlimited AI generation for as long as the outage lasts —
// on a shared free-tier provider quota, that can drain the quota for every
// tenant, not just the one hitting the failure.
//
// Design goal (explicitly NOT full fail-closed, which would turn every
// transient blip into a platform-wide AI outage — a product trade-off this
// module does not make unilaterally): after a SHORT run of *consecutive*
// dependency failures on this warm instance, stop trying the DB for a short
// cooldown and deny AI requests outright; after the cooldown, try again
// (half-open). A single isolated blip still fails open exactly as before —
// only a genuinely sustained outage trips the breaker, and only for AI
// endpoints that opt in by calling aiRateLimit() instead of rateLimit().
//
// Known limitation (documented, not silently overstated): this state is
// per-warm-serverless-instance, in-memory, and does not coordinate across
// concurrently running instances or survive a cold start. It bounds the
// worst case per instance; it is not a global circuit breaker. A true
// cross-instance breaker would need an external store (e.g. a dedicated
// Postgres table with its own short-timeout read) — left as a future
// enhancement, not implemented here since it adds another dependency that
// itself needs failure handling.
const CONSECUTIVE_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 30_000

let consecutiveFailures = 0
let circuitOpenUntil = 0

export interface AiRateLimitResult extends RateLimitResult {
  /** true when this result came from the emergency circuit breaker, not the DB */
  emergencyFailClosed?: boolean
}

export async function aiRateLimit(key: string, opts: RateLimitOptions): Promise<AiRateLimitResult> {
  if (Date.now() < circuitOpenUntil) {
    return { allowed: false, remaining: 0, resetAt: circuitOpenUntil, emergencyFailClosed: true }
  }

  const { data, error } = await adminClient()
    .rpc('check_rate_limit', { p_key: key, p_limit: opts.limit, p_window_secs: opts.windowSecs })
    .abortSignal(AbortSignal.timeout(RATE_LIMIT_RPC_TIMEOUT_MS))

  if (error || !data) {
    consecutiveFailures++
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS
      return { allowed: false, remaining: 0, resetAt: circuitOpenUntil, emergencyFailClosed: true }
    }
    // Below threshold — a single blip still fails open, same as rateLimit().
    return fallbackAllow(opts)
  }

  const row = data as Record<string, unknown>
  if (
    typeof row.allowed !== 'boolean' ||
    typeof row.remaining !== 'number' ||
    typeof row.reset_at !== 'string'
  ) {
    consecutiveFailures++
    return fallbackAllow(opts)
  }

  consecutiveFailures = 0 // any successful read resets the breaker immediately
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: new Date(row.reset_at).getTime(),
  }
}

// Test-only: reset module-level circuit state between test cases.
export function _resetAiRateLimitCircuitForTests(): void {
  consecutiveFailures = 0
  circuitOpenUntil = 0
}
