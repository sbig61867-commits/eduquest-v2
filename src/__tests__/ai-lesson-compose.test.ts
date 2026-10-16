// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Gemini SDK stand-in: each call is driven by the test through `plan`.
type Plan = (prompt: string, signal?: AbortSignal) => Promise<unknown>
let plan: Plan
const generateContent = vi.fn((prompt: string, opts?: { signal?: AbortSignal }) => plan(prompt, opts?.signal))
let modelTimeouts: Array<number | undefined> = []
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(_p: unknown, o?: { timeout?: number }) { modelTimeouts.push(o?.timeout); return { generateContent } }
  },
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

// The tests approve Gemini and Groq for institution content to exercise the
// composition logic. The real table approves nothing for it (privacy.ts).
vi.mock('@/lib/ai/privacy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/privacy')>('@/lib/ai/privacy')
  const approve = (p: string, a: unknown) => Array.isArray(a) && a.length > 0 && (p === 'gemini' || p === 'groq')
  return {
    ...actual,
    providerApproved: approve,
    audienceApproved: (a: unknown) => approve('gemini', a),
    assertProviderApproved: (p: string, a: unknown) => { if (!approve(p, a)) throw new actual.PrivacyPendingError([]) },
  }
})

import { composeLesson, composeWithGemini, composeWithFallbackChain, COMPOSE_BUDGET_MS, GEMINI_CHUNK_TIMEOUT_MS } from '@/lib/ai/lesson-compose'
import { runMetered, type MeterState } from '@/lib/ai/meter'

const fetchMock = vi.fn()
const para = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i} ` + 'x'.repeat(12000)).join('\n\n')
const ok = (text: string) => ({ response: { text: () => text, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } } })
const abortable = (signal: AbortSignal | undefined, ms: number, value: string) => new Promise((res, rej) => {
  const t = setTimeout(() => res(ok(value)), ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
})

function input(text: string, deadline = Date.now() + COMPOSE_BUDGET_MS) {
  return { fullText: text, level: 'undergraduate', customInstructions: '', qTypes: ['mcq'], audiences: ['institution'] as const, deadline }
}
const state = (): MeterState => ({ feature: 'lesson-from-file', userId: 'u', blocked: false, calls: [] })

// The provider modules load the SDK with a dynamic import. Load the mocked module
// once up front, so concurrent chunks never race the mock registry.
beforeAll(async () => { await import('@google/generative-ai') })

beforeEach(() => {
  generateContent.mockClear(); fetchMock.mockReset(); modelTimeouts = []
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'k'); vi.stubEnv('GROQ_API_KEY', 'k')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('composeWithGemini', () => {
  it('uses the per-chunk timeout, not the 25 s default', async () => {
    plan = async () => ok('part')
    await composeWithGemini(input('short text') as never)
    expect(modelTimeouts[0]).toBe(GEMINI_CHUNK_TIMEOUT_MS)
  })

  it('caps the per-chunk timeout by the remaining budget', async () => {
    plan = async () => ok('part')
    await composeWithGemini(input('short', Date.now() + 5000) as never)
    expect(modelTimeouts[0]).toBeLessThanOrEqual(5000)
  })

  it('joins chunks in source order', async () => {
    plan = async (p) => ok(`[${p.match(/Paragraph (\d+)/)?.[1]}]`)
    const out = await composeWithGemini(input(para(4)) as never)
    expect(generateContent).toHaveBeenCalledTimes(4)
    expect(out.split('\n\n')).toEqual(['[0]', '[2]', '[1]', '[3]'].sort((a, b) => out.indexOf(a) - out.indexOf(b)))
  })

  it('one chunk fails: siblings are aborted, and it returns only after every call settled and was metered', async () => {
    let settled = 0
    plan = (p, signal) => {
      const n = Number(p.match(/Paragraph (\d+)/)?.[1])
      const run = n === 0
        ? new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('quota'), { status: 429 })), 5))
        : abortable(signal, 10_000, 'late')
      return run.finally(() => { settled++ })
    }
    const s = state()
    const err = await runMetered(s, () => composeWithGemini(input(para(4)) as never)).catch(e => e)
    expect(err).toMatchObject({ provider: 'gemini', code: '429' }) // the original failure, not an abort
    expect(settled).toBe(generateContent.mock.calls.length)       // nothing still running
    expect(s.calls).toHaveLength(generateContent.mock.calls.length) // every call metered
    expect(s.calls.filter(c => c.ok)).toHaveLength(0)
  })
})

describe('composeLesson fallback', () => {
  it('starts the chain only after all Gemini calls settled', async () => {
    const order: string[] = []
    plan = (p, signal) => {
      const n = Number(p.match(/Paragraph (\d+)/)?.[1])
      if (n === 0) return Promise.reject(Object.assign(new Error('x'), { status: 503 }))
      return abortable(signal, 10_000, 'late').finally(() => order.push('gemini-settled'))
    }
    fetchMock.mockImplementation(async () => {
      order.push('chain')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'c' } }] }), { status: 200 })
    })
    const s = state()
    const r = await runMetered(s, () => composeLesson(input(para(3)) as never))
    expect(r.provider).toBe('groq')
    expect(order.indexOf('chain')).toBeGreaterThan(order.lastIndexOf('gemini-settled'))
    expect(s.calls.filter(c => c.provider === 'gemini')).toHaveLength(generateContent.mock.calls.length)
  })

  it('all Gemini chunks fail: falls back once, every attempt metered', async () => {
    plan = () => Promise.reject(Object.assign(new Error('x'), { status: 500 }))
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'c' } }] }), { status: 200 }))
    const s = state()
    const r = await runMetered(s, () => composeLesson(input('one chunk') as never))
    expect(r).toEqual({ content: 'c', provider: 'groq' })
    expect(s.calls.map(c => `${c.provider}:${c.ok}`)).toEqual(['gemini:false', 'groq:true'])
  })

  it('a Gemini timeout falls back like any failure', async () => {
    plan = () => Promise.reject(Object.assign(new Error('t'), { name: 'GoogleGenerativeAIAbortError' }))
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'c' } }] }), { status: 200 }))
    const s = state()
    await runMetered(s, () => composeLesson(input('x') as never))
    expect(s.calls[0]).toMatchObject({ provider: 'gemini', ok: false, error: 'timeout' })
  })
})

describe('composeWithFallbackChain time budget', () => {
  it('does not start a chunk with under 30 s left, and starts no request at all', async () => {
    const err = await composeWithFallbackChain(input(para(2), Date.now() + 10_000) as never).catch(e => e)
    expect(err).toMatchObject({ code: 'budget' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops between chunks once the budget is spent', async () => {
    // The chain's own deadline check reads the real clock; the chunk loop reads `now`.
    const base = Date.now()
    let t = 0
    const now = () => base + t
    fetchMock.mockImplementation(async () => { t += 200_000; return new Response(JSON.stringify({ choices: [{ message: { content: 'c' } }] }), { status: 200 }) })
    const err = await composeWithFallbackChain({ ...input(para(6), base + 250_000), now } as never).catch(e => e)
    // Chunk 1 at t=0 (250 s left), chunk 2 at t=200 s (50 s left, still >= 30 s),
    // then t=400 s is past the deadline: no chunk 3.
    expect(err).toMatchObject({ code: 'budget' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
