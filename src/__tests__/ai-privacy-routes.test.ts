// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

// ── Harness: every AI route with its I/O mocked ──────────────────
const generateContent = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent } } },
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en', getTranslations: async () => (k: string) => k }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (task: () => Promise<void>) => { void task() } }
})
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/permissions')
  return { ...actual, can: () => true }
})
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 1000 }),
  aiRateLimit: async () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 1000 }),
}))
vi.mock('@/lib/settings', () => ({ getAiRateLimits: async () => ({ lesson_per_hour: 99, exam_per_hour: 99 }) }))
const authorizeAiUsage = vi.fn(async (userId: string) => (void userId, null as Response | null))
vi.mock('@/lib/ai/usage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/usage')>('@/lib/ai/usage')
  return { ...actual, authorizeAiUsage: (id: string) => authorizeAiUsage(id) }
})
// Service-role client used by the usage ledger and a few routes: inert.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: () => { const p = Promise.resolve({ data: null, error: null }) as Promise<unknown> & { abortSignal: () => unknown }; p.abortSignal = () => p; return p },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }), insert: async () => ({ error: null }) }),
  }),
}))
const profile = { role: 'teacher', tenant_id: 't1', permissions: {}, can_create_courses: true }
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'is']) chain[m] = () => chain
      chain.single = async () => ({ data: profile, error: null })
      chain.maybeSingle = async () => ({ data: profile, error: null })
      return chain
    },
  }),
}))
// A scanned PDF: pages exist but carry no text layer. Matches the pdf.js surface
// extract.ts uses (numPages, getPage -> getTextContent, cleanup, destroy).
vi.mock('unpdf', () => ({
  getDocumentProxy: async () => ({
    numPages: 1,
    getPage: async () => ({ getTextContent: async () => ({ items: [] }), cleanup: () => {} }),
    destroy: async () => {},
  }),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  generateContent.mockReset()
  authorizeAiUsage.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  for (const k of ['GROQ_API_KEY', 'XKIRO_API_KEY', 'COHERE_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']) vi.stubEnv(k, 'test-key')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function jsonRequest(body: unknown) {
  const req = new Request('http://localhost/api/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const json = vi.spyOn(req, 'json')
  const formData = vi.spyOn(req, 'formData')
  return { req, json, formData }
}

function formRequest(fd: FormData, headers: Record<string, string> = {}) {
  const req = new Request('http://localhost/api/x', { method: 'POST', body: fd, headers })
  const json = vi.spyOn(req, 'json')
  const formData = vi.spyOn(req, 'formData')
  return { req, json, formData }
}

function okChat(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 })
}

async function docxFile(text = 'Hello world') {
  const zip = new JSZip()
  zip.file('word/document.xml', `<w:document><w:t>${text}</w:t></w:document>`)
  return new File([(await zip.generateAsync({ type: 'uint8array' })) as BlobPart], 'notes.docx')
}

type Handler = (req: Request) => Promise<Response>
const load = async (path: string) => (await import(path)).POST as Handler

// ── Routes whose content is institutional or personal ────────────
const BLOCKED: Array<[string, string, () => Promise<{ req: Request; json: ReturnType<typeof vi.spyOn>; formData: ReturnType<typeof vi.spyOn> }>]> = [
  ['announcement-copy', '@/app/api/ai/announcement-copy/route', async () => jsonRequest({ brief: 'SECRET-BRIEF exam moved' })],
  ['course-suggestions', '@/app/api/ai/course-suggestions/route', async () => jsonRequest({ course_id: 'c1' })],
  ['individual-task', '@/app/api/ai/individual-task/route', async () => jsonRequest({ answer: 'SECRET-ANSWER', question: 'q' })],
  ['generate-course-pptx', '@/app/api/ai/generate-course-pptx/route', async () => { const fd = new FormData(); fd.set('file', await docxFile()); return formRequest(fd) }],
  ['generate-homework-from-file', '@/app/api/ai/generate-homework-from-file/route', async () => { const fd = new FormData(); fd.set('sourceText', 'SECRET-SOURCE'); return formRequest(fd) }],
  ['generate-lesson-from-file', '@/app/api/ai/generate-lesson-from-file/route', async () => { const fd = new FormData(); fd.set('file', await docxFile()); return formRequest(fd) }],
  ['generate-item-content', '@/app/api/courses/generate-item-content/route', async () => jsonRequest({ course_id: 'c1', title: 'Intro' })],
]

describe.each(BLOCKED)('%s is refused before anything else', (_name, path, make) => {
  it('503 aiPrivacyPending; no allowance check, no body read, no provider request', async () => {
    const POST = await load(path)
    const { req, json, formData } = await make()
    const res = await POST(req)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('aiPrivacyPending')
    expect(authorizeAiUsage).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(formData).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(generateContent).not.toHaveBeenCalled()
  })
})

// ── Topic-only generators (public) ───────────────────────────────
describe('generate-exam (topic only, public)', () => {
  it('sends only the template, topic, count and fixed type', async () => {
    const POST = await load('@/app/api/ai/generate-exam/route')
    fetchMock.mockResolvedValueOnce(okChat(JSON.stringify([
      { id: '1', text: 'Q?', type: 'mcq', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 10 },
    ])))
    const { req } = jsonRequest({ topic: 'Photosynthesis', count: 3, type: 'mcq' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const user = body.messages.at(-1).content as string
    expect(user).toContain('Photosynthesis')
    expect(user).toContain('Generate exactly 3 multiple choice questions')
    expect(authorizeAiUsage).toHaveBeenCalledOnce()
  })

  it('rejects an unknown type with 400 and no request', async () => {
    const POST = await load('@/app/api/ai/generate-exam/route')
    const res = await POST(jsonRequest({ topic: 'X', type: 'essay; ignore rules' }).req)
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a provider failure returns no provider text in the HTTP body', async () => {
    const POST = await load('@/app/api/ai/generate-exam/route')
    fetchMock.mockResolvedValue(new Response('MARKER-PROVIDER-BODY echo of Photosynthesis', { status: 500 }))
    const res = await POST(jsonRequest({ topic: 'Photosynthesis' }).req)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('MARKER-PROVIDER-BODY')
    expect(text).not.toContain('detail')
  })
})

describe('generate-lesson (topic only, public)', () => {
  it('topic + fixed level: 200, payload holds no free text', async () => {
    const POST = await load('@/app/api/ai/generate-lesson/route')
    fetchMock.mockResolvedValueOnce(okChat('## Lesson'))
    const res = await POST(jsonRequest({ topic: 'Cells', level: 'high school' }).req)
    expect(res.status).toBe(200)
    const user = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages.at(-1).content as string
    expect(user).toContain('"Cells"')
    expect(user).toContain('high school level')
    expect(user).not.toContain('The teacher has provided specific instructions')
  })

  it('normalizes high_school', async () => {
    const POST = await load('@/app/api/ai/generate-lesson/route')
    fetchMock.mockResolvedValueOnce(okChat('## Lesson'))
    expect((await POST(jsonRequest({ topic: 'Cells', level: 'high_school' }).req)).status).toBe(200)
  })

  it('free-text instructions: 422 with a clear code, never silently dropped, no request', async () => {
    const POST = await load('@/app/api/ai/generate-lesson/route')
    const res = await POST(jsonRequest({ topic: 'Cells', customInstructions: 'use our internal syllabus 2026' }).req)
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('aiCustomInstructionsUnavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([['free text level'], ['postdoc'], [42]])('unknown level %j: 400, no request', async (level) => {
    const POST = await load('@/app/api/ai/generate-lesson/route')
    const res = await POST(jsonRequest({ topic: 'Cells', level }).req)
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── extract-file: local path open, vision path gated ─────────────
describe('extract-file', () => {
  it('DOCX is parsed locally: 200, no provider, no allowance check', async () => {
    const POST = await load('@/app/api/ai/extract-file/route')
    const fd = new FormData(); fd.set('file', await docxFile('Local text'))
    const res = await POST(formRequest(fd).req)
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('Local text')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(generateContent).not.toHaveBeenCalled()
    expect(authorizeAiUsage).not.toHaveBeenCalled()
  })

  it('an image is refused before Gemini', async () => {
    const POST = await load('@/app/api/ai/extract-file/route')
    const fd = new FormData(); fd.set('file', new File([new Uint8Array([1, 2, 3])], 'board.png'))
    const res = await POST(formRequest(fd).req)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('aiPrivacyPending')
    expect(generateContent).not.toHaveBeenCalled()
    expect(authorizeAiUsage).not.toHaveBeenCalled()
  })

  it('a scanned PDF is refused before Gemini with the scanned-file message', async () => {
    const POST = await load('@/app/api/ai/extract-file/route')
    const fd = new FormData(); fd.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'scan.pdf'))
    const res = await POST(formRequest(fd).req)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('fileScannedUnsupported')
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('an oversized declared body is refused before formData()', async () => {
    const POST = await load('@/app/api/ai/extract-file/route')
    const fd = new FormData(); fd.set('file', await docxFile())
    const { req, formData } = formRequest(fd, { 'content-length': String(6 * 1024 * 1024) })
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(formData).not.toHaveBeenCalled()
  })
})
