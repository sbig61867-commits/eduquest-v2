/**
 * R-2: bounded emergency circuit breaker for AI rate limiting.
 *
 * Covers:
 *  1. A single isolated dependency failure still fails OPEN (unchanged
 *     behavior for a transient blip — no platform-wide AI outage).
 *  2. N consecutive failures trip the circuit → fails CLOSED for a
 *     cooldown window (bounds "unlimited AI" during a sustained outage).
 *  3. A successful check resets the failure counter immediately.
 *  4. The plain rateLimit() (used by cheap endpoints) never fails closed,
 *     regardless of how many consecutive failures occur — proves the
 *     breaker is scoped to aiRateLimit() only, not global.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the Supabase admin client factory so we control RPC success/failure
// without touching a real database.
const rpcMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => {
      rpcMock(...args)
      return {
        abortSignal: () => rpcMock.mock.results.at(-1)!.value,
      }
    },
  }),
}))

describe('aiRateLimit() emergency circuit breaker', () => {
  beforeEach(async () => {
    vi.resetModules()
    rpcMock.mockReset()
    const { _resetAiRateLimitCircuitForTests } = await import('@/lib/rate-limit')
    _resetAiRateLimitCircuitForTests()
  })

  function mockRpcResult(result: { data: unknown; error: unknown }) {
    rpcMock.mockImplementationOnce(() => Promise.resolve(result))
  }

  it('a single isolated failure still fails open (unchanged from before)', async () => {
    const { aiRateLimit } = await import('@/lib/rate-limit')
    mockRpcResult({ data: null, error: new Error('transient blip') })

    const result = await aiRateLimit('test-key', { limit: 10, windowSecs: 3600 })
    expect(result.allowed).toBe(true)
    expect(result.emergencyFailClosed).toBeUndefined()
  })

  it('trips the circuit after 3 consecutive failures and fails closed', async () => {
    const { aiRateLimit } = await import('@/lib/rate-limit')
    mockRpcResult({ data: null, error: new Error('fail 1') })
    mockRpcResult({ data: null, error: new Error('fail 2') })
    mockRpcResult({ data: null, error: new Error('fail 3') })

    const r1 = await aiRateLimit('test-key', { limit: 10, windowSecs: 3600 })
    expect(r1.allowed).toBe(true) // failures 1-2 still open

    const r2 = await aiRateLimit('test-key', { limit: 10, windowSecs: 3600 })
    expect(r2.allowed).toBe(true)

    const r3 = await aiRateLimit('test-key', { limit: 10, windowSecs: 3600 })
    expect(r3.allowed).toBe(false) // 3rd consecutive failure trips the breaker
    expect(r3.emergencyFailClosed).toBe(true)
  })

  it('once tripped, denies immediately without calling the DB again during cooldown', async () => {
    const { aiRateLimit } = await import('@/lib/rate-limit')
    mockRpcResult({ data: null, error: new Error('fail 1') })
    mockRpcResult({ data: null, error: new Error('fail 2') })
    mockRpcResult({ data: null, error: new Error('fail 3') })

    await aiRateLimit('k', { limit: 10, windowSecs: 3600 })
    await aiRateLimit('k', { limit: 10, windowSecs: 3600 })
    await aiRateLimit('k', { limit: 10, windowSecs: 3600 }) // trips here

    const callsBeforeCooldownCheck = rpcMock.mock.calls.length
    const r4 = await aiRateLimit('k', { limit: 10, windowSecs: 3600 })
    expect(r4.allowed).toBe(false)
    expect(r4.emergencyFailClosed).toBe(true)
    // No new RPC attempt while the circuit is open
    expect(rpcMock.mock.calls.length).toBe(callsBeforeCooldownCheck)
  })

  it('a success resets the consecutive-failure counter immediately', async () => {
    const { aiRateLimit } = await import('@/lib/rate-limit')
    mockRpcResult({ data: null, error: new Error('fail 1') })
    mockRpcResult({ data: null, error: new Error('fail 2') })
    mockRpcResult({ data: { allowed: true, remaining: 5, reset_at: new Date().toISOString() }, error: null })
    mockRpcResult({ data: null, error: new Error('fail 3') })
    mockRpcResult({ data: null, error: new Error('fail 4') })

    await aiRateLimit('k', { limit: 10, windowSecs: 3600 }) // fail 1
    await aiRateLimit('k', { limit: 10, windowSecs: 3600 }) // fail 2
    const success = await aiRateLimit('k', { limit: 10, windowSecs: 3600 }) // success — resets counter
    expect(success.allowed).toBe(true)

    // Two more failures after the reset should NOT trip the breaker yet
    // (counter restarted from 0, threshold is 3).
    const afterReset1 = await aiRateLimit('k', { limit: 10, windowSecs: 3600 })
    expect(afterReset1.emergencyFailClosed).toBeUndefined()
    const afterReset2 = await aiRateLimit('k', { limit: 10, windowSecs: 3600 })
    expect(afterReset2.emergencyFailClosed).toBeUndefined()
  })
})

describe('rateLimit() (cheap/session endpoints) never fails closed', () => {
  beforeEach(() => {
    vi.resetModules()
    rpcMock.mockReset()
  })

  it('stays fail-open across many consecutive failures — no platform-wide outage', async () => {
    const { rateLimit } = await import('@/lib/rate-limit')
    for (let i = 0; i < 10; i++) {
      rpcMock.mockImplementationOnce(() => Promise.resolve({ data: null, error: new Error(`fail ${i}`) }))
      const result = await rateLimit('login-key', { limit: 5, windowSecs: 3600 })
      expect(result.allowed).toBe(true)
    }
  })
})
