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

// ── R-2 Layer 2 (time-based): circuit breaker for AI endpoints ────────────
//
// Per warm process only. Each serverless instance keeps its own state; nothing
// is shared between instances, so this is NOT a platform-wide breaker.
//
// Closed (normal):
//   Every check calls the database. A failure that starts a new episode records
//   the time of the first failure. A success ends the episode. Until the
//   episode has lasted AI_BREAKER_SUSPECT_MS, a failed check is allowed
//   (transient errors do not cause an outage).
//   When a failure arrives and the episode has lasted AI_BREAKER_SUSPECT_MS or
//   more, the breaker OPENS. The episode is only evaluated on a failure, so an
//   episode that sees no traffic for 20 seconds opens on the next failure.
//
// Open (sustained failure):
//   Every check is denied without calling the database, except one probe.
//   A probe is allowed once per AI_BREAKER_PROBE_INTERVAL_MS, and only one
//   probe may be in flight at a time (the flag is set synchronously before the
//   await, so concurrent requests in the same process cannot start a second).
//   A probe that succeeds closes the breaker. A probe that fails keeps it open
//   and schedules the next probe one interval later.
//
// Allowance: this breaker covers the per-user rate limit only. The institution
// monthly allowance (authorizeAiUsage) runs first and fails closed on its own.
export const AI_BREAKER_SUSPECT_MS = 20_000
export const AI_BREAKER_PROBE_INTERVAL_MS = 15_000

export interface AiRateLimitResult extends RateLimitResult {
  /** true when this result came from the circuit breaker, not the DB */
  emergencyFailClosed?: boolean
}

interface BreakerState {
  /** Start of the current failure episode; null when there is none. */
  firstFailureAt: number | null
  /** When the breaker opened; 0 when closed. */
  openSince: number
  /** Earliest time the next probe may start while open. */
  nextProbeAt: number
  probeInFlight: boolean
}

const freshBreaker = (): BreakerState => ({ firstFailureAt: null, openSince: 0, nextProbeAt: 0, probeInFlight: false })

let breaker: BreakerState = freshBreaker()
let clock: () => number = () => Date.now()

type CheckOutcome = { ok: true; result: RateLimitResult } | { ok: false }

/** One call to the RPC. Any error, malformed row or thrown exception counts as a failure. */
async function checkRpc(key: string, opts: RateLimitOptions): Promise<CheckOutcome> {
  try {
    const { data, error } = await adminClient()
      .rpc('check_rate_limit', { p_key: key, p_limit: opts.limit, p_window_secs: opts.windowSecs })
      .abortSignal(AbortSignal.timeout(RATE_LIMIT_RPC_TIMEOUT_MS))
    if (error || !data) return { ok: false }
    const row = data as Record<string, unknown>
    if (typeof row.allowed !== 'boolean' || typeof row.remaining !== 'number' || typeof row.reset_at !== 'string') {
      return { ok: false }
    }
    return { ok: true, result: { allowed: row.allowed, remaining: row.remaining, resetAt: new Date(row.reset_at).getTime() } }
  } catch {
    return { ok: false }
  }
}

function emergencyDenial(): AiRateLimitResult {
  return { allowed: false, remaining: 0, resetAt: breaker.nextProbeAt, emergencyFailClosed: true }
}

export async function aiRateLimit(key: string, opts: RateLimitOptions): Promise<AiRateLimitResult> {
  if (breaker.openSince > 0) {
    if (breaker.probeInFlight || clock() < breaker.nextProbeAt) return emergencyDenial()
    // Claim the probe before the first await, so no concurrent call can claim it too.
    breaker.probeInFlight = true
    breaker.nextProbeAt = clock() + AI_BREAKER_PROBE_INTERVAL_MS
    try {
      const probe = await checkRpc(key, opts)
      if (probe.ok) {
        breaker = freshBreaker()
        return probe.result
      }
      return emergencyDenial()
    } finally {
      // Only the probe reaches this line while open, so `breaker` is the same object.
      breaker.probeInFlight = false
    }
  }

  const check = await checkRpc(key, opts)
  if (check.ok) {
    breaker.firstFailureAt = null
    return check.result
  }

  const failedAt = clock()
  const episodeStart = breaker.firstFailureAt ?? failedAt
  breaker.firstFailureAt = episodeStart
  if (failedAt - episodeStart >= AI_BREAKER_SUSPECT_MS) {
    breaker.openSince = failedAt
    breaker.nextProbeAt = failedAt + AI_BREAKER_PROBE_INTERVAL_MS
    return emergencyDenial()
  }
  // Transient: this check fails open, as rateLimit() does.
  return fallbackAllow(opts)
}

// Test-only: reset circuit state and the clock between test cases.
export function _resetAiRateLimitCircuitForTests(): void {
  breaker = freshBreaker()
  clock = () => Date.now()
}

// Test-only: inject a deterministic clock.
export function _setAiRateLimitClockForTests(fn: () => number): void {
  clock = fn
}
