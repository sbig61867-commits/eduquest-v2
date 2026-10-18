// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

// Every Gemini request goes through generateContent; count it.
const generateContent = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent } }
  },
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { PRIVACY_APPROVALS, PrivacyPendingError, assertProviderApproved, audienceApproved, providerApproved } from '@/lib/ai/privacy'
import { meterCall, runMetered, type MeterState } from '@/lib/ai/meter'
import { groqChat } from '@/lib/ai/groq'
import { aiChat, aiChatDetailed, geminiCompose, generateLessonContentAI } from '@/lib/ai/chat'
import { extractTextFromFile } from '@/lib/ai/extract'

const fetchMock = vi.fn()
const KEYS = ['GROQ_API_KEY', 'XKIRO_API_KEY', 'COHERE_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']

function okChat(content = 'ok') {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 })
}

beforeEach(() => {
  fetchMock.mockReset()
  generateContent.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  for (const k of KEYS) vi.stubEnv(k, 'test-key')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('privacy table', () => {
  // Owner decisions 2026-10-18: teacher (institution) content flows to the free
  // chain again; students' own (personal) content, redacted, goes to Groq ONLY.
  it('approves public and institution content everywhere, personal for Groq only', () => {
    for (const [p, row] of Object.entries(PRIVACY_APPROVALS)) {
      expect(row, p).toEqual({ public: true, institution: true, personal: p === 'groq' })
    }
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['not a list', 'public'],
    ['empty', []],
    ['unknown audience', ['public', 'secret']],
  ])('refuses %s', (_label, audiences) => {
    expect(providerApproved('groq', audiences)).toBe(false)
    expect(() => assertProviderApproved('groq', audiences)).toThrow(PrivacyPendingError)
  })

  it.each(['xkiro', 'cohere', 'gemini', 'openrouter'])('%s never receives personal content', (p) => {
    for (const a of [['personal'], ['public', 'personal'], ['institution', 'personal']]) {
      expect(providerApproved(p, a)).toBe(false)
      expect(() => assertProviderApproved(p, a)).toThrow(PrivacyPendingError)
    }
  })

  it('groq receives personal content, alone or with institution content', () => {
    expect(providerApproved('groq', ['personal'])).toBe(true)
    expect(providerApproved('groq', ['institution', 'personal'])).toBe(true)
  })

  it('refuses an unknown provider and prototype keys, even for public', () => {
    expect(providerApproved('cerebras', ['public'])).toBe(false)
    expect(providerApproved('__proto__', ['public'])).toBe(false)
    expect(providerApproved('constructor', ['public'])).toBe(false)
  })

  it('a key alone is not approval: only the table decides', () => {
    expect(audienceApproved(['personal'])).toBe(true)
    expect(audienceApproved(['institution', 'personal'])).toBe(true)
    expect(audienceApproved(['nope'])).toBe(false)
    expect(audienceApproved(['institution'])).toBe(true)
    expect(audienceApproved(['public'])).toBe(true)
  })
})

describe('meterCall enforces the audience before run()', () => {
  it.each([
    ['groq', undefined], ['groq', []], ['groq', ['nope']], ['gemini', ['personal']], ['cohere', ['institution', 'personal']],
  ])('%s with audience %j: run() never starts and nothing is recorded', async (provider, audiences) => {
    const run = vi.fn(async () => ({ value: 'x' }))
    const state: MeterState = { feature: 't', userId: 'u', blocked: false, calls: [] }
    await expect(runMetered(state, () => meterCall(provider as string, 'm', 1, audiences as never, run))).rejects.toThrow(PrivacyPendingError)
    expect(run).not.toHaveBeenCalled()
    expect(state.calls).toHaveLength(0)
  })

  it('public: run() starts and the call is recorded', async () => {
    const run = vi.fn(async () => ({ value: 'x', inputTokens: 1, outputTokens: 1 }))
    const state: MeterState = { feature: 't', userId: 'u', blocked: false, calls: [] }
    await runMetered(state, () => meterCall('groq', 'm', 1, ['public'], run))
    expect(run).toHaveBeenCalledOnce()
    expect(state.calls).toHaveLength(1)
  })
})

describe('every provider exit point refuses unapproved content with zero requests', () => {
  it('groqChat', async () => {
    await expect(groqChat('p', undefined, 0.5, ['nope'] as never)).rejects.toThrow(PrivacyPendingError)
    await expect(groqChat('p', undefined, 0.5, undefined as never)).rejects.toThrow(PrivacyPendingError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aiChatDetailed / aiChat (whole chain: groq, xkiro, cohere, gemini, openrouter)', async () => {
    await expect(aiChatDetailed('p', undefined, { audiences: [] })).rejects.toThrow(PrivacyPendingError)
    await expect(aiChatDetailed('p', undefined, undefined as never)).rejects.toThrow(PrivacyPendingError)
    await expect(aiChat('p', undefined, {} as never)).rejects.toThrow(PrivacyPendingError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('geminiCompose', async () => {
    await expect(geminiCompose('p', { audiences: ['personal'] })).rejects.toThrow(PrivacyPendingError)
    await expect(geminiCompose('p', {} as never)).rejects.toThrow(PrivacyPendingError)
    expect(generateContent).not.toHaveBeenCalled()
  })

})

describe('personal content goes to Groq only (owner, 2026-10-18)', () => {
  it('reaches Groq once', async () => {
    fetchMock.mockResolvedValueOnce(okChat('answer'))
    const r = await aiChatDetailed('redacted question', undefined, { audiences: ['personal'] })
    expect(r).toEqual({ content: 'answer', provider: 'groq' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.groq.com')
  })

  it('when Groq fails, no other provider is tried', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 500 }))
    await expect(aiChatDetailed('redacted question', undefined, { audiences: ['institution', 'personal'] })).rejects.toThrow()
    for (const call of fetchMock.mock.calls) expect(String(call[0])).toContain('api.groq.com')
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('geminiCompose refuses it with zero requests', async () => {
    await expect(geminiCompose('p', { audiences: ['personal'] })).rejects.toThrow(PrivacyPendingError)
    expect(generateContent).not.toHaveBeenCalled()
  })
})

describe('institution content flows again (owner, 2026-10-18)', () => {
  it('generateLessonContentAI with free-text instructions reaches Groq once', async () => {
    fetchMock.mockResolvedValueOnce(okChat('lesson'))
    const r = await generateLessonContentAI('t', 'undergraduate', 'internal notes')
    expect(r.provider).toBe('groq')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('aiChatDetailed institution reaches the chain', async () => {
    fetchMock.mockResolvedValueOnce(okChat('ok'))
    const r = await aiChatDetailed('teacher file text', undefined, { audiences: ['institution'] })
    expect(r).toEqual({ content: 'ok', provider: 'groq' })
  })
})

describe('approved public content still flows', () => {
  it('aiChatDetailed public: Groq is called once with the prompt', async () => {
    fetchMock.mockResolvedValueOnce(okChat('lesson'))
    const r = await aiChatDetailed('topic only', 'sys', { audiences: ['public'] })
    expect(r).toEqual({ content: 'lesson', provider: 'groq' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.groq.com')
  })

  it('generateLessonContentAI without instructions is public and reaches the chain', async () => {
    fetchMock.mockResolvedValueOnce(okChat('lesson'))
    const r = await generateLessonContentAI('Photosynthesis', 'graduate')
    expect(r.provider).toBe('groq')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.messages.at(-1).content).toContain('Photosynthesis')
  })

  it('local DOCX extraction never calls a provider', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:t>Hello</w:t><w:t>world</w:t></w:document>')
    const buf = await zip.generateAsync({ type: 'uint8array' })
    const text = await extractTextFromFile(new File([buf as BlobPart], 'a.docx'))
    expect(text).toBe('Hello world')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(generateContent).not.toHaveBeenCalled()
  })
})
