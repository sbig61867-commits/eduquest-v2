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
import { groqChat, generateLessonContentGroq } from '@/lib/ai/groq'
import { aiChat, aiChatDetailed, geminiCompose, generateLessonContentAI } from '@/lib/ai/chat'
import { generateLessonContent } from '@/lib/ai/gemini'
import { ExtractionError, extractTextFromFile } from '@/lib/ai/extract'

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
  it('approves only public content, and only for groq', () => {
    for (const [p, row] of Object.entries(PRIVACY_APPROVALS)) {
      const expected = p !== 'groq'
        ? { public: false, institution: false, personal: false }
        : { public: true, institution: false, personal: false }
      expect(row, p).toEqual(expected)
    }
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['not a list', 'public'],
    ['empty', []],
    ['unknown audience', ['public', 'secret']],
    ['institution', ['institution']],
    ['personal', ['personal']],
    ['mixed', ['public', 'institution']],
  ])('refuses %s', (_label, audiences) => {
    expect(providerApproved('groq', audiences)).toBe(false)
    expect(() => assertProviderApproved('groq', audiences)).toThrow(PrivacyPendingError)
  })

  it('refuses an unknown provider and prototype keys, even for public', () => {
    expect(providerApproved('cerebras', ['public'])).toBe(false)
    expect(providerApproved('__proto__', ['public'])).toBe(false)
    expect(providerApproved('constructor', ['public'])).toBe(false)
  })

  it('a key alone is not approval: institution stays refused with every key set', () => {
    expect(audienceApproved(['institution'])).toBe(false)
    expect(audienceApproved(['personal'])).toBe(false)
    expect(audienceApproved(['public'])).toBe(true)
  })
})

describe('meterCall enforces the audience before run()', () => {
  it.each([
    [undefined], [[]], [['nope']], [['institution']], [['personal']],
  ])('audience %j: run() never starts and nothing is recorded', async (audiences) => {
    const run = vi.fn(async () => ({ value: 'x' }))
    const state: MeterState = { feature: 't', userId: 'u', blocked: false, calls: [] }
    await expect(runMetered(state, () => meterCall('groq', 'm', 1, audiences as never, run))).rejects.toThrow(PrivacyPendingError)
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
    await expect(groqChat('p', undefined, 0.5, ['institution'])).rejects.toThrow(PrivacyPendingError)
    await expect(groqChat('p', undefined, 0.5, undefined as never)).rejects.toThrow(PrivacyPendingError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aiChatDetailed / aiChat (whole chain: groq, xkiro, cohere, gemini, openrouter)', async () => {
    await expect(aiChatDetailed('p', undefined, { audiences: ['institution'] })).rejects.toThrow(PrivacyPendingError)
    await expect(aiChatDetailed('p', undefined, { audiences: ['personal'] })).rejects.toThrow(PrivacyPendingError)
    await expect(aiChatDetailed('p', undefined, { audiences: [] })).rejects.toThrow(PrivacyPendingError)
    await expect(aiChatDetailed('p', undefined, undefined as never)).rejects.toThrow(PrivacyPendingError)
    await expect(aiChat('p', undefined, {} as never)).rejects.toThrow(PrivacyPendingError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('geminiCompose', async () => {
    await expect(geminiCompose('p', { audiences: ['institution'] })).rejects.toThrow(PrivacyPendingError)
    await expect(geminiCompose('p', {} as never)).rejects.toThrow(PrivacyPendingError)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('gemini.ts generateLessonContent (unused, kept)', async () => {
    await expect(generateLessonContent('t', 'undergraduate', 'internal notes')).rejects.toThrow(PrivacyPendingError)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('groq.ts generateLessonContentGroq (unused, kept)', async () => {
    await expect(generateLessonContentGroq('t', 'undergraduate', 'internal notes')).rejects.toThrow(PrivacyPendingError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('generateLessonContentAI with free-text instructions is institutional', async () => {
    await expect(generateLessonContentAI('t', 'undergraduate', 'internal notes')).rejects.toThrow(PrivacyPendingError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('vision extraction of an image never reaches Gemini', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'scan.png')
    const err = await extractTextFromFile(file).catch(e => e)
    expect(err).toBeInstanceOf(ExtractionError)
    expect((err as ExtractionError).code).toBe('privacy_pending')
    expect(generateContent).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
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
