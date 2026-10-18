// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Improve this block" (2026-10-18): teachers only, institutional audience,
// metered, rate-limited, and only renderable Markdown comes back.

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en', getTranslations: async () => (k: string) => k }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (task: () => Promise<void>) => { void task() } }
})
const rateLimit = vi.fn(async (key: string, opts: unknown) => (void key, void opts, { allowed: true, remaining: 9, resetAt: 0 }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (k: string, o: unknown) => rateLimit(k, o) }))
const authorizeAiUsage = vi.fn(async (userId: string) => (void userId, null as Response | null))
vi.mock('@/lib/ai/usage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/usage')>('@/lib/ai/usage')
  return { ...actual, authorizeAiUsage: (id: string) => authorizeAiUsage(id) }
})
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: () => { const p = Promise.resolve({ data: null, error: null }) as Promise<unknown> & { abortSignal: () => unknown }; p.abortSignal = () => p; return p },
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}))
const state = { role: 'teacher' as string, user: { id: 'u1' } as { id: string } | null }
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.single = async () => ({ data: { role: state.role }, error: null })
      return chain
    },
  }),
}))
const aiChat = vi.fn(async (...args: unknown[]) => (void args, 'Simpler **text**.'))
vi.mock('@/lib/ai/chat', () => ({ aiChat: (...a: unknown[]) => aiChat(...a) }))

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/ai/improve-block/route')
  return POST(new Request('http://localhost/api/ai/improve-block', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  state.role = 'teacher'; state.user = { id: 'u1' }
  aiChat.mockClear(); rateLimit.mockClear(); authorizeAiUsage.mockClear()
})

describe('/api/ai/improve-block', () => {
  it('returns the suggestion for a teacher, through the allowance and the rate limit', async () => {
    const res = await post({ text: 'A hard sentence.', action: 'simplify', lessonTitle: 'Cells' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ suggestion: 'Simpler **text**.' })
    expect(authorizeAiUsage).toHaveBeenCalledWith('u1')
    expect(rateLimit.mock.calls[0][0]).toBe('improve_block:u1')
    expect(aiChat.mock.calls[0][2]).toMatchObject({ audiences: ['institution'] })
  })

  it('refuses signed-out users and students before any AI call', async () => {
    state.user = null
    expect((await post({ text: 'x', action: 'fix' })).status).toBe(401)
    state.user = { id: 'u1' }; state.role = 'student'
    expect((await post({ text: 'x', action: 'fix' })).status).toBe(403)
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('validates the action and the length', async () => {
    expect((await post({ text: 'x', action: 'rewrite-everything' })).status).toBe(400)
    expect((await post({ text: '', action: 'fix' })).status).toBe(400)
    expect((await post({ text: 'x'.repeat(4001), action: 'fix' })).status).toBe(400)
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('answers 429 when rate-limited', async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    expect((await post({ text: 'x', action: 'fix' })).status).toBe(429)
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('strips fences and HTML tags from the suggestion', async () => {
    aiChat.mockResolvedValueOnce('```markdown\n<script>x</script>Plain **bold** text\n```')
    const res = await post({ text: 'x', action: 'fix' })
    expect((await res.json()).suggestion).toBe('xPlain **bold** text')
  })

  it('rejects a suggestion the rich editor cannot show (a table)', async () => {
    aiChat.mockResolvedValueOnce('| a | b |\n|---|---|\n| 1 | 2 |')
    expect((await post({ text: 'x', action: 'expand' })).status).toBe(502)
  })

  it('answers 503 when the providers fail', async () => {
    aiChat.mockRejectedValueOnce(new Error('down'))
    expect((await post({ text: 'x', action: 'fix' })).status).toBe(503)
  })
})
