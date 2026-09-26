// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks for the route wrapper (service-role client, after(), apiErr) ──
const rpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (fn: string, args: unknown) => {
      const result = rpc(fn, args)
      const p = Promise.resolve(result) as Promise<unknown> & { abortSignal: () => Promise<unknown> }
      p.abortSignal = () => p
      return p
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      insert: async () => ({ error: null }),
    }),
  }),
}))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (task: () => Promise<void>) => { void task() } }
})
vi.mock('@/lib/api-error', () => ({
  apiErr: async (code: string) => ({ error: code, code }),
}))

import { summarizeAiCalls, meterCall, runMetered, estimateTokens, geminiUsage, type AiCallRecord, type MeterState } from '@/lib/ai/meter'
import { DEFAULT_AI_PRICING, mergeAiPricing, priceFor, costUsd } from '@/lib/ai/pricing'
import { resolveUsageRange, projectMonthEnd, daysBetween, usageShare, toUsageRange, usageReportCsv, type AiUsageReport } from '@/lib/ai/usage-report'
import { meteredAiRoute, authorizeAiUsage } from '@/lib/ai/usage'

const flush = () => new Promise(r => setTimeout(r, 0))

describe('summarizeAiCalls', () => {
  it('folds a fallback chain into one row: last successful provider, all attempts counted', () => {
    const calls: AiCallRecord[] = [
      { provider: 'groq', model: 'openai/gpt-oss-120b', ok: false, ms: 120, error: '429' },
      { provider: 'gemini', model: 'gemini-2.5-flash', ok: true, inputTokens: 2000, outputTokens: 1000, ms: 900 },
    ]
    const s = summarizeAiCalls(calls, DEFAULT_AI_PRICING)
    expect(s.provider).toBe('gemini')
    expect(s.model).toBe('gemini-2.5-flash')
    expect(s.providerCalls).toBe(2)
    expect(s.failedCalls).toBe(1)
    expect(s.inputTokens).toBe(2000)
    expect(s.outputTokens).toBe(1000)
    // 2000 × $0.30/M + 1000 × $2.50/M
    expect(s.listCostUsd).toBeCloseTo(0.0031, 10)
    expect(s.billedCostUsd).toBe(0) // free tier: nothing billed
    expect(s.latencyMs).toBe(1020)
    expect(s.detail.calls[0]).toMatchObject({ p: 'groq', ok: false, err: '429', in: 0, out: 0 })
  })

  it('estimates tokens a provider did not report, and flags them', () => {
    const s = summarizeAiCalls(
      [{ provider: 'cohere', model: 'command-a-03-2025', ok: true, ms: 10, promptChars: 300, outputChars: 90 }],
      DEFAULT_AI_PRICING,
    )
    expect(s.inputTokens).toBe(100)
    expect(s.outputTokens).toBe(30)
    expect(s.estimated).toBe(true)
    expect(s.detail.calls[0]).toMatchObject({ est: true })
  })

  it('prices OpenRouter :free routes as the paid model and flags unknown models', () => {
    const s = summarizeAiCalls([
      { provider: 'openrouter', model: 'minimax/minimax-m3:free', ok: true, inputTokens: 1_000_000, outputTokens: 0, ms: 1 },
      { provider: 'openrouter', model: 'someone/new-model:free', ok: true, inputTokens: 10, outputTokens: 10, ms: 1 },
    ], DEFAULT_AI_PRICING)
    expect(s.listCostUsd).toBeCloseTo(0.30, 10)
    expect(s.detail.calls[0]).not.toHaveProperty('np')
    expect(s.detail.calls[1]).toMatchObject({ np: true, cost: 0 })
  })

  it('counts a billed provider as actual cost', () => {
    const pricing = { ...DEFAULT_AI_PRICING, billedProviders: ['groq'] }
    const s = summarizeAiCalls(
      [{ provider: 'groq', model: 'openai/gpt-oss-120b', ok: true, inputTokens: 1_000_000, outputTokens: 1_000_000, ms: 1 }],
      pricing,
    )
    expect(s.listCostUsd).toBeCloseTo(0.75, 10)
    expect(s.billedCostUsd).toBeCloseTo(0.75, 10)
  })
})

describe('pricing', () => {
  it('merges stored overrides over the verified defaults and drops malformed entries', () => {
    const p = mergeAiPricing({
      models: {
        'gemini-2.5-flash': { input: 1, output: 2 },
        'custom/model:free': { input: 0.5, output: 0.5 },
        'broken': { input: -1, output: 'x' },
      },
      billedProviders: ['gemini', 42],
    })
    expect(priceFor(p, 'gemini-2.5-flash')).toEqual({ input: 1, output: 2 })
    expect(priceFor(p, 'custom/model')).toEqual({ input: 0.5, output: 0.5 })
    expect(priceFor(p, 'broken')).toBeNull()
    expect(priceFor(p, 'openai/gpt-oss-120b')).toEqual(DEFAULT_AI_PRICING.models['openai/gpt-oss-120b'])
    expect(p.billedProviders).toEqual(['gemini'])
    expect(costUsd({ input: 2, output: 4 }, 500_000, 250_000)).toBeCloseTo(2, 10)
  })

  it('falls back to the defaults for an empty or missing setting', () => {
    expect(mergeAiPricing(null)).toEqual(DEFAULT_AI_PRICING)
  })
})

describe('provider usage helpers', () => {
  it('bills Gemini thinking tokens as output', () => {
    expect(geminiUsage({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } }))
      .toEqual({ inputTokens: 10, outputTokens: 12 })
    expect(geminiUsage({})).toEqual({})
  })

  it('estimates roughly three characters per token', () => {
    expect(estimateTokens(9)).toBe(3)
    expect(estimateTokens(undefined)).toBe(0)
  })

  it('records calls only inside a metered scope, and never changes the result', async () => {
    const outside = await meterCall('groq', 'm', 1, async () => ({ value: 'a' }))
    expect(outside).toBe('a')

    const state: MeterState = { feature: 'x', userId: null, blocked: false, calls: [] }
    await runMetered(state, async () => {
      await meterCall('groq', 'm', 3, async () => ({ value: 'ok', inputTokens: 4, outputTokens: 5 }))
      await expect(meterCall('xkiro', 'm2', 3, async () => { throw new Error('upstream 503: busy') })).rejects.toThrow('503')
    })
    expect(state.calls).toHaveLength(2)
    expect(state.calls[0]).toMatchObject({ provider: 'groq', ok: true, inputTokens: 4, outputTokens: 5 })
    expect(state.calls[1]).toMatchObject({ provider: 'xkiro', ok: false, error: '503' })
  })
})

describe('usage report helpers', () => {
  const now = new Date('2026-09-26T15:00:00Z')

  it('resolves periods as inclusive UTC days', () => {
    expect(resolveUsageRange('7', now)).toEqual({ from: '2026-09-20', to: '2026-09-26' })
    expect(resolveUsageRange('30', now)).toEqual({ from: '2026-08-28', to: '2026-09-26' })
    expect(resolveUsageRange('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-26' })
    expect(resolveUsageRange('prev', now)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolveUsageRange('prev', new Date('2026-01-10T00:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(toUsageRange('nonsense')).toBe('30')
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  })

  it('projects the month end linearly, never from less than one day', () => {
    // 15 days into a 30-day month, $15 so far → $30.
    expect(projectMonthEnd(15, new Date('2026-09-16T00:00:00Z'))).toBeCloseTo(30, 6)
    // One hour into the month counts as a full day.
    expect(projectMonthEnd(1, new Date('2026-09-01T01:00:00Z'))).toBeCloseTo(30, 6)
  })

  it('reports usage share, with 0 meaning AI switched off', () => {
    expect(usageShare(5, null)).toBeNull()
    expect(usageShare(5, 10)).toBe(0.5)
    expect(usageShare(0, 0)).toBe(1)
    expect(usageShare(1, 0)).toBe(Infinity)
  })

  it('exports CSV with escaped cells and an Excel BOM', () => {
    const report = {
      from: '2026-09-01', to: '2026-09-26', month: '2026-09-01', metering_started_at: null,
      totals: {} as AiUsageReport['totals'], month_totals: { requests: 0, tokens: 0, list_cost_usd: 0, billed_cost_usd: 0 },
      latency: { avg_ms: null, p95_ms: null }, series: [], by_feature: [], providers: [], top_users: [], recent_failures: [],
      platform: { requests: 0, input_tokens: 0, output_tokens: 0, list_cost_usd: 0 },
      by_tenant: [{ tenant_name: 'Uni, "North"', requests: 3 } as AiUsageReport['by_tenant'][number]],
    } as AiUsageReport
    const csv = usageReportCsv(report)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"Uni, ""North""",3')
  })
})

describe('meteredAiRoute', () => {
  beforeEach(() => rpc.mockReset())

  it('writes one success row with the summed tokens when the handler returns 2xx', async () => {
    rpc.mockImplementation((fn: string) =>
      fn === 'check_ai_allowance' ? { data: { allowed: true, limited: false }, error: null } : { data: null, error: null })
    const POST = meteredAiRoute('lesson', async () => {
      const denied = await authorizeAiUsage('user-1')
      if (denied) return denied
      await meterCall('groq', 'openai/gpt-oss-120b', 10, async () => ({ value: 'x', inputTokens: 100, outputTokens: 50 }))
      await meterCall('groq', 'openai/gpt-oss-120b', 10, async () => ({ value: 'y', inputTokens: 100, outputTokens: 50 }))
      return new Response('ok', { status: 200 })
    })
    const res = await POST()
    expect(res.status).toBe(200)
    await flush()
    const record = rpc.mock.calls.find(c => c[0] === 'record_ai_usage')
    expect(record?.[1]).toMatchObject({
      p_user: 'user-1', p_feature: 'lesson', p_status: 'success', p_provider: 'groq',
      p_provider_calls: 2, p_input_tokens: 200, p_output_tokens: 100,
    })
  })

  it('refuses with 429 and logs a blocked row when the institution is over its allowance', async () => {
    rpc.mockImplementation((fn: string) =>
      fn === 'check_ai_allowance' ? { data: { allowed: false, limited: true, over: true }, error: null } : { data: null, error: null })
    const provider = vi.fn()
    const POST = meteredAiRoute('exam', async () => {
      const denied = await authorizeAiUsage('user-2')
      if (denied) return denied
      provider()
      return new Response('ok')
    })
    const res = await POST()
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ code: 'aiInstitutionLimitReached' })
    expect(provider).not.toHaveBeenCalled()
    await flush()
    expect(rpc.mock.calls.find(c => c[0] === 'record_ai_usage')?.[1]).toMatchObject({ p_status: 'blocked', p_provider_calls: 0 })
  })

  it('logs a failed row when a provider was called but the response is an error', async () => {
    rpc.mockImplementation(() => ({ data: { allowed: true }, error: null }))
    const POST = meteredAiRoute('exam', async () => {
      await authorizeAiUsage('user-3')
      await meterCall('groq', 'openai/gpt-oss-120b', 10, async () => ({ value: 'not json', inputTokens: 5, outputTokens: 5 }))
      return new Response('bad', { status: 500 })
    })
    await POST()
    await flush()
    expect(rpc.mock.calls.find(c => c[0] === 'record_ai_usage')?.[1]).toMatchObject({ p_status: 'failed', p_input_tokens: 5 })
  })

  it('writes nothing for a request that never reached a provider', async () => {
    rpc.mockImplementation(() => ({ data: { allowed: true }, error: null }))
    const POST = meteredAiRoute('lesson', async () => {
      await authorizeAiUsage('user-4')
      return new Response('invalid', { status: 400 })
    })
    await POST()
    await flush()
    expect(rpc.mock.calls.some(c => c[0] === 'record_ai_usage')).toBe(false)
  })

  it('fails open when the allowance check errors', async () => {
    rpc.mockImplementation((fn: string) =>
      fn === 'check_ai_allowance' ? { data: null, error: { code: 'XX000', message: 'db down' } } : { data: null, error: null })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await meteredAiRoute('lesson', async () => (await authorizeAiUsage('user-5')) ?? new Response('ok'))()
    expect(res.status).toBe(200)
    spy.mockRestore()
  })
})
