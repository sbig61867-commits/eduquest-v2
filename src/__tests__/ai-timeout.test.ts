/**
 * AI request timeout behavior (R-9).
 *
 * Covers:
 *  1. AI_TIMEOUT_MS honors AI_REQUEST_TIMEOUT_MS env var, falls back to a
 *     safe default when unset/invalid.
 *  2. groqChat() aborts a hanging request and throws a clear timeout error
 *     instead of hanging indefinitely (no retry — a single clean failure).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('AI_TIMEOUT_MS configuration', () => {
  const ORIGINAL_ENV = process.env.AI_REQUEST_TIMEOUT_MS

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS
    else process.env.AI_REQUEST_TIMEOUT_MS = ORIGINAL_ENV
    vi.resetModules()
  })

  it('falls back to the 25s default when the env var is unset', async () => {
    delete process.env.AI_REQUEST_TIMEOUT_MS
    vi.resetModules()
    const { AI_TIMEOUT_MS } = await import('@/lib/ai/timeout')
    expect(AI_TIMEOUT_MS).toBe(25_000)
  })

  it('falls back to the default when the env var is not a valid positive number', async () => {
    process.env.AI_REQUEST_TIMEOUT_MS = 'not-a-number'
    vi.resetModules()
    const { AI_TIMEOUT_MS } = await import('@/lib/ai/timeout')
    expect(AI_TIMEOUT_MS).toBe(25_000)

    process.env.AI_REQUEST_TIMEOUT_MS = '-5000'
    vi.resetModules()
    const mod2 = await import('@/lib/ai/timeout')
    expect(mod2.AI_TIMEOUT_MS).toBe(25_000)
  })

  it('honors a valid override from the env var', async () => {
    process.env.AI_REQUEST_TIMEOUT_MS = '5000'
    vi.resetModules()
    const { AI_TIMEOUT_MS } = await import('@/lib/ai/timeout')
    expect(AI_TIMEOUT_MS).toBe(5_000)
  })

  it('isAbortError() correctly identifies an AbortError vs. an unrelated error', async () => {
    const { isAbortError } = await import('@/lib/ai/timeout')
    const abortErr = new DOMException('The operation was aborted.', 'AbortError')
    expect(isAbortError(abortErr)).toBe(true)
    expect(isAbortError(new Error('network down'))).toBe(false)
    expect(isAbortError('not an error object')).toBe(false)
  })
})

describe('groqChat() timeout behavior', () => {
  const ORIGINAL_ENV = process.env.AI_REQUEST_TIMEOUT_MS
  const ORIGINAL_KEY = process.env.GROQ_API_KEY

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key'
    // Very short timeout so the test doesn't actually wait 25s.
    process.env.AI_REQUEST_TIMEOUT_MS = '50'
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS
    else process.env.AI_REQUEST_TIMEOUT_MS = ORIGINAL_ENV
    if (ORIGINAL_KEY === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = ORIGINAL_KEY
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('aborts a hanging request and throws a clear timeout error (no retry storm)', async () => {
    let fetchCallCount = 0
    // A fetch that never resolves on its own — only the AbortSignal can end it.
    // Real `fetch` in Node honors the `signal` option and rejects with an
    // AbortError when it fires, which is what we're asserting groqChat()
    // surfaces as a clean, single error (not a hang, not a retry).
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      fetchCallCount++
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    }))

    const { groqChat } = await import('@/lib/ai/groq')

    await expect(groqChat('test prompt')).rejects.toThrow('Groq API error: request timed out')
    // Exactly one attempt — a timeout must never trigger an automatic retry.
    expect(fetchCallCount).toBe(1)
  })

  it('does not swallow non-timeout fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('DNS resolution failed'))))
    const { groqChat } = await import('@/lib/ai/groq')
    await expect(groqChat('test prompt')).rejects.toThrow('DNS resolution failed')
  })
})
