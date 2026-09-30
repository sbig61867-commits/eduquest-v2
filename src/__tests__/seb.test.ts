// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeSebKey, sebConfigKeyHash, verifySebProof } from '@/lib/seb'

// Vector computed independently (Python hashlib): SHA-256(url + key).
const KEY = 'ab'.repeat(32)
const URL_ = 'https://eduquest.test/student/exams/11111111-1111-4111-8111-111111111111'
const HASH = '27c449bf124ffec578018c61ca7a3f1b416ebec8162cd25b9c27d269372338e2'
const ORIGIN = 'https://eduquest.test'

describe('Safe Exam Browser proof', () => {
  it('matches the reference hash', () => {
    expect(sebConfigKeyHash(URL_, KEY)).toBe(HASH)
  })

  it('accepts SEB proof for our exam page', () => {
    expect(verifySebProof(KEY, { pageUrl: URL_, configKeyHash: HASH }, ORIGIN)).toBe(true)
    expect(verifySebProof(KEY, { pageUrl: `${URL_}#q3`, configKeyHash: HASH.toUpperCase() }, ORIGIN)).toBe(true)
  })

  it('refuses a missing, wrong or replayed proof', () => {
    expect(verifySebProof(KEY, null, ORIGIN)).toBe(false)
    expect(verifySebProof(KEY, { pageUrl: URL_ }, ORIGIN)).toBe(false)
    expect(verifySebProof(KEY, { pageUrl: URL_, configKeyHash: '0'.repeat(64) }, ORIGIN)).toBe(false)
    expect(verifySebProof('cd'.repeat(32), { pageUrl: URL_, configKeyHash: HASH }, ORIGIN)).toBe(false)
    // Another site, or a page that is not the exam.
    expect(verifySebProof(KEY, { pageUrl: 'https://evil.test/student/exams/x', configKeyHash: HASH }, ORIGIN)).toBe(false)
    expect(verifySebProof(KEY, { pageUrl: 'https://eduquest.test/about', configKeyHash: sebConfigKeyHash('https://eduquest.test/about', KEY) }, ORIGIN)).toBe(false)
    expect(verifySebProof(KEY, { pageUrl: 'not a url', configKeyHash: HASH }, ORIGIN)).toBe(false)
  })

  it('normalizes keys', () => {
    expect(normalizeSebKey(` ${KEY.toUpperCase()} `)).toBe(KEY)
    expect(normalizeSebKey('abc')).toBeNull()
    expect(normalizeSebKey(null)).toBeNull()
  })
})

// ── /api/exam/start refuses a SEB exam without the proof ──
const state = vi.hoisted(() => ({ seb: null as string | null, rpcCalled: false }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'student-1' } } }) } }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, is: () => chain, single: async () => ({ data: { id: 'e1', tenant_id: 't1', seb_config_key: state.seb } }) }
      return chain
    },
    rpc: async () => { state.rpcCalled = true; return { data: { started_at: new Date().toISOString(), resumed: false }, error: null } },
  }),
}))
vi.mock('@/lib/exam-roster', () => ({ isOnExamRoster: async () => true }))
vi.mock('@/lib/exam-files', () => ({ signFileMap: async () => ({}) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { POST } from '@/app/api/exam/start/route'

const start = (seb?: unknown) => POST(new Request('https://eduquest.test/api/exam/start', {
  method: 'POST', body: JSON.stringify({ examId: 'e1', seb }),
}))

describe('exam start with a SEB requirement', () => {
  beforeEach(() => { state.seb = null; state.rpcCalled = false })

  it('starts normally when the exam does not require SEB', async () => {
    expect((await start()).status).toBe(200)
    expect(state.rpcCalled).toBe(true)
  })

  it('refuses without SEB and never starts the attempt', async () => {
    state.seb = KEY
    const res = await start(null)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'sebRequired', seb_required: true })
    expect(state.rpcCalled).toBe(false)
  })

  it('starts inside SEB with the right configuration', async () => {
    state.seb = KEY
    expect((await start({ pageUrl: URL_, configKeyHash: HASH })).status).toBe(200)
    expect(state.rpcCalled).toBe(true)
  })
})
