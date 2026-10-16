/**
 * Time-based circuit breaker for aiRateLimit() (R-2, revised). Deterministic:
 * the clock is injected and the RPC is a controllable deferred.
 *
 * Covers
 *  - transient failures fail open and never open the breaker
 *  - a failure episode that lasts 20 s opens the breaker
 *  - an open breaker denies without touching the database
 *  - one probe every 15 s, and only one probe in flight
 *  - a successful probe closes the breaker
 *  - repeated failed probes keep it open and reschedule
 *  - concurrent requests during open and during suspicion
 *  - plain rateLimit() never fails closed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Reply = { data: unknown; error: unknown } | 'throw'
const rpcQueue: Array<() => Promise<Reply>> = []
const rpcCalls = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => {
      rpcCalls(...args)
      return {
        abortSignal: async () => {
          const next = rpcQueue.shift()
          if (!next) throw new Error('no rpc reply queued')
          const reply = await next()
          if (reply === 'throw') throw new Error('network down')
          return reply
        },
      }
    },
  }),
}))

const OK = { data: { allowed: true, remaining: 5, reset_at: new Date(Date.now() + 60_000).toISOString() }, error: null }
const FAIL = { data: null, error: new Error('db down') }
const immediate = (r: Reply) => () => Promise.resolve(r)
const opts = { limit: 10, windowSecs: 3600 }

let now = 0
const at = (s: number) => { now = s * 1000 }

async function load() {
  const mod = await import('@/lib/rate-limit')
  return mod
}

beforeEach(async () => {
  vi.resetModules()
  rpcQueue.length = 0
  rpcCalls.mockReset()
  now = 0
  const mod = await load()
  mod._resetAiRateLimitCircuitForTests()
  mod._setAiRateLimitClockForTests(() => now)
})

describe('transient failures do not cause an outage', () => {
  it('a single failure fails open and does not open the breaker', async () => {
    const { aiRateLimit } = await load()
    rpcQueue.push(immediate(FAIL))
    const r = await aiRateLimit('k', opts)
    expect(r.allowed).toBe(true)
    expect(r.emergencyFailClosed).toBeUndefined()
  })

  it('failures interleaved with successes never accumulate into an episode', async () => {
    const { aiRateLimit } = await load()
    for (const [t, reply] of [[0, FAIL], [5, OK], [10, FAIL], [15, OK], [25, FAIL], [30, OK]] as const) {
      at(t)
      rpcQueue.push(immediate(reply))
      const r = await aiRateLimit('k', opts)
      expect(r.emergencyFailClosed).toBeUndefined()
    }
  })

  it('a thrown RPC counts as a failure, not as an uncaught error', async () => {
    const { aiRateLimit } = await load()
    rpcQueue.push(immediate('throw'))
    const r = await aiRateLimit('k', opts)
    expect(r.allowed).toBe(true)
  })
})

describe('sustained failures open the breaker after 20 seconds', () => {
  it('failures spread over 19 s stay fail-open', async () => {
    const { aiRateLimit } = await load()
    for (const t of [0, 5, 10, 15, 19]) {
      at(t)
      rpcQueue.push(immediate(FAIL))
      const r = await aiRateLimit('k', opts)
      expect(r.emergencyFailClosed).toBeUndefined()
    }
  })

  it('the failure that completes 20 s opens the breaker and is denied', async () => {
    const { aiRateLimit } = await load()
    for (const t of [0, 5, 10, 15]) { at(t); rpcQueue.push(immediate(FAIL)); await aiRateLimit('k', opts) }
    at(20)
    rpcQueue.push(immediate(FAIL))
    const r = await aiRateLimit('k', opts)
    expect(r.allowed).toBe(false)
    expect(r.emergencyFailClosed).toBe(true)
    expect(r.resetAt).toBe(35_000)
  })
})

describe('an open breaker does not call the database', () => {
  it('denies every check until the next probe is due, with no RPC', async () => {
    const { aiRateLimit } = await load()
    for (const t of [0, 5, 10, 15, 20]) { at(t); rpcQueue.push(immediate(FAIL)); await aiRateLimit('k', opts) }
    const callsAfterOpen = rpcCalls.mock.calls.length
    for (const t of [21, 25, 34]) {
      at(t)
      const r = await aiRateLimit('k', opts)
      expect(r.allowed).toBe(false)
    }
    expect(rpcCalls.mock.calls.length).toBe(callsAfterOpen)
  })
})

describe('recovery probe', () => {
  it('a successful probe at 35 s closes the breaker', async () => {
    const { aiRateLimit } = await load()
    for (const t of [0, 5, 10, 15, 20]) { at(t); rpcQueue.push(immediate(FAIL)); await aiRateLimit('k', opts) }
    at(35)
    rpcQueue.push(immediate(OK))
    const probe = await aiRateLimit('k', opts)
    expect(probe.allowed).toBe(true)
    expect(probe.emergencyFailClosed).toBeUndefined()

    // Closed again: ordinary checks reach the database.
    rpcQueue.push(immediate(OK))
    const after = await aiRateLimit('k', opts)
    expect(after.allowed).toBe(true)
    expect(rpcCalls.mock.calls.length).toBe(7)
  })

  it('repeated failed probes stay open and each one waits a full interval', async () => {
    const { aiRateLimit } = await load()
    for (const t of [0, 5, 10, 15, 20]) { at(t); rpcQueue.push(immediate(FAIL)); await aiRateLimit('k', opts) }

    at(35); rpcQueue.push(immediate(FAIL))
    expect((await aiRateLimit('k', opts)).allowed).toBe(false)     // probe 1 fails, next at 50
    at(49); expect((await aiRateLimit('k', opts)).allowed).toBe(false) // no probe yet
    at(50); rpcQueue.push(immediate(FAIL))
    expect((await aiRateLimit('k', opts)).allowed).toBe(false)     // probe 2 fails, next at 65
    at(64); expect((await aiRateLimit('k', opts)).allowed).toBe(false)

    // Exactly two probes reached the database after the breaker opened (35 s and 50 s).
    expect(rpcCalls.mock.calls.length).toBe(5 + 2)
  })
})

describe('concurrency', () => {
  it('while open and a probe is due, only one probe reaches the database', async () => {
    const { aiRateLimit } = await load()
    for (const t of [0, 5, 10, 15, 20]) { at(t); rpcQueue.push(immediate(FAIL)); await aiRateLimit('k', opts) }

    at(35)
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    rpcQueue.push(async () => { await gate; return OK })

    const burst = Array.from({ length: 10 }, () => aiRateLimit('k', opts))
    release()
    const results = await Promise.all(burst)
    expect(rpcCalls.mock.calls.length).toBe(5 + 1)
    expect(results.filter(r => r.allowed).length).toBe(1)
    expect(results.filter(r => r.emergencyFailClosed).length).toBe(9)
  })

  it('during suspicion, concurrent failures share one episode start', async () => {
    const { aiRateLimit } = await load()
    at(0)
    rpcQueue.push(immediate(FAIL), immediate(FAIL), immediate(FAIL))
    const r = await Promise.all([aiRateLimit('k', opts), aiRateLimit('k', opts), aiRateLimit('k', opts)])
    expect(r.every(x => x.allowed)).toBe(true)
    at(20)
    rpcQueue.push(immediate(FAIL))
    expect((await aiRateLimit('k', opts)).emergencyFailClosed).toBe(true)
  })
})

describe('rateLimit() (cheap/session endpoints) never fails closed', () => {
  it('stays fail-open across many consecutive failures', async () => {
    const { rateLimit } = await load()
    for (let i = 0; i < 10; i++) {
      rpcQueue.push(immediate(FAIL))
      const result = await rateLimit('login-key', { limit: 5, windowSecs: 3600 })
      expect(result.allowed).toBe(true)
    }
  })
})
