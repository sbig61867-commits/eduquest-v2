// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Markers planted in every place provider or user text can come from. None of
// them may reach console, Sentry, a thrown error's message or an HTTP body.
const BODY = 'MARKER-PROVIDER-BODY'
const SDK = 'MARKER-SDK-MESSAGE'
const PROMPT = 'MARKER-PROMPT'
const FILE_NAME = 'MARKER-FILENAME'

const generateContent = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent } } },
}))
const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureException: (...a: unknown[]) => captureException(...a) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { aiChatDetailed } from '@/lib/ai/chat'
import { groqChat } from '@/lib/ai/groq'
import { AiProviderError, geminiProviderError, logAiFailure } from '@/lib/ai/meter'
import { extractTextFromFile, extractionErrorResponse } from '@/lib/ai/extract'

const fetchMock = vi.fn()
let logged: unknown[][] = []

function dump(v: unknown): string {
  if (v instanceof Error) return `${v.name} ${v.message} ${JSON.stringify(v)} ${String((v as { cause?: unknown }).cause ?? '')}`
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}
function everything(extra: unknown[] = []): string {
  return [...logged.flat(), ...captureException.mock.calls.flat(), ...extra].map(dump).join('\n')
}
function expectClean(extra: unknown[] = []) {
  const all = everything(extra)
  for (const m of [BODY, SDK, PROMPT, FILE_NAME]) expect(all, m).not.toContain(m)
}

beforeEach(() => {
  logged = []
  fetchMock.mockReset(); generateContent.mockReset(); captureException.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  for (const k of ['GROQ_API_KEY', 'XKIRO_API_KEY', 'COHERE_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']) vi.stubEnv(k, 'test-key')
  for (const level of ['error', 'warn', 'log', 'info', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logged.push(a) })
  }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('provider failures never carry provider or prompt text', () => {
  it.each([400, 401, 429, 500, 503])('whole chain fails with HTTP %i: console, Sentry and the thrown error are clean', async (status) => {
    fetchMock.mockImplementation(async () => new Response(`${BODY} you said: ${PROMPT}`, { status }))
    generateContent.mockRejectedValue(Object.assign(new Error(`${SDK} [${status}] ${PROMPT}`), { status }))
    const err = await aiChatDetailed(`${PROMPT} topic`, 'sys', { audiences: ['public'] }).catch(e => e)
    expect(err).toBeInstanceOf(AiProviderError)
    expect(fetchMock).toHaveBeenCalledTimes(1) // groq only: xkiro, cohere, openrouter not approved
    expect(generateContent).not.toHaveBeenCalled() // gemini not approved
    expect(captureException).toHaveBeenCalledOnce()
    expectClean([err])
  })

  it('network failure and timeout are reduced to a code', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed ${BODY}`))
    const e1 = await aiChatDetailed(PROMPT, undefined, { audiences: ['public'] }).catch(e => e)
    expect(e1).toBeTruthy()
    const abort = Object.assign(new Error(`${SDK} aborted`), { name: 'AbortError' })
    fetchMock.mockRejectedValue(abort)
    const e2 = await groqChat(PROMPT, undefined, 0.5, ['public']).catch(e => e)
    expect(String(e2.message)).toBe('Groq API error: request timed out')
    expectClean([e2])
  })

  it('Gemini SDK errors keep the status only', () => {
    const e = geminiProviderError(Object.assign(new Error(`${SDK} ${PROMPT}`), { status: 429 }))
    expect(e).toEqual(expect.objectContaining({ provider: 'gemini', code: '429' }))
    expect(e.message).not.toContain(SDK)
    const a = geminiProviderError(Object.assign(new Error(`${SDK}`), { name: 'GoogleGenerativeAIAbortError' }))
    expect(a.code).toBe('timeout')
  })

  it('logAiFailure prints a category, never the message', () => {
    logAiFailure('[t]', new Error(`${BODY} ${PROMPT}`))
    logAiFailure('[t]', `${BODY} as a string`)
    logAiFailure('[t]', { message: BODY })
    expectClean()
  })
})

describe('file failures never carry file names or contents', () => {
  it.each([
    [`${FILE_NAME}.docx`, `${PROMPT} not a zip`],
    [`${FILE_NAME}.pptx`, `${PROMPT} not a zip`],
    [`${FILE_NAME}.exe`, PROMPT],
  ])('%s: error, response body and logs are clean', async (name, content) => {
    const err = await extractTextFromFile(new File([content], name)).catch(e => e)
    const res = await extractionErrorResponse(err)
    logAiFailure('[extract]', err)
    expectClean([err.message, res])
  })
})
