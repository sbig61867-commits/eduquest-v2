// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

// Gate G review findings, one block per finding.

const generateContent = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent } } },
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

// A controllable stand-in for unpdf's pdf.js proxy.
let pdfDoc: { numPages: number; pageText: (n: number) => string; onPage?: (n: number) => void }
const destroyed = vi.fn()
const getPage = vi.fn()
vi.mock('unpdf', () => ({
  getDocumentProxy: async () => ({
    numPages: pdfDoc.numPages,
    getPage: async (n: number) => {
      getPage(n)
      pdfDoc.onPage?.(n)
      return { getTextContent: async () => ({ items: [{ str: pdfDoc.pageText(n), hasEOL: false }] }), cleanup: () => {} }
    },
    destroy: async () => { destroyed() },
  }),
}))

import {
  PDF_MAX_MS, PDF_MAX_PAGES, PDF_MAX_TEXT_CHARS, UPLOAD_MAX_REQUEST_BYTES,
  ExtractionError, extractTextFromFile, readFormDataCapped,
} from '@/lib/ai/extract'
import { callTimeoutMs, AI_TIMEOUT_MS } from '@/lib/ai/timeout'
import { aiChatDetailed } from '@/lib/ai/chat'
import { COMPOSE_BUDGET_MS, GEMINI_CHUNK_TIMEOUT_MS } from '@/lib/ai/lesson-compose'

const ROOT = path.resolve(__dirname, '../..')
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset(); generateContent.mockReset(); getPage.mockReset(); destroyed.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

// ── 1. Request body intake ───────────────────────────────────────
function streamOf(totalBytes: number, chunk = 64 * 1024) {
  let sent = 0
  let pulled = 0
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= totalBytes) { ctrl.close(); return }
      const n = Math.min(chunk, totalBytes - sent)
      sent += n; pulled += n
      ctrl.enqueue(new Uint8Array(n).fill(0x61))
    },
  }, { highWaterMark: 0 }) // pull only when a reader asks, so `pulled` counts what the code read
  return { body, pulled: () => pulled }
}

describe('readFormDataCapped never buffers more than the cap', () => {
  it('chunked body with NO Content-Length past the cap: refused, stream not read to the end', async () => {
    const s = streamOf(20 * 1024 * 1024)
    const req = new Request('http://x', { method: 'POST', body: s.body, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=b' } } as RequestInit)
    const err = await readFormDataCapped(req).catch(e => e)
    expect(err).toBeInstanceOf(ExtractionError)
    expect(err.code).toBe('too_large')
    expect(s.pulled()).toBeLessThan(UPLOAD_MAX_REQUEST_BYTES + 256 * 1024)
  })

  it('an understated Content-Length does not lift the cap', async () => {
    const s = streamOf(10 * 1024 * 1024)
    const req = new Request('http://x', { method: 'POST', body: s.body, duplex: 'half', headers: { 'content-length': '100', 'content-type': 'multipart/form-data; boundary=b' } } as RequestInit)
    expect((await readFormDataCapped(req).catch(e => e)).code).toBe('too_large')
  })

  it('an overstated Content-Length is refused before any byte is read', async () => {
    const s = streamOf(10)
    const req = new Request('http://x', { method: 'POST', body: s.body, duplex: 'half', headers: { 'content-length': String(UPLOAD_MAX_REQUEST_BYTES + 1) } } as RequestInit)
    expect((await readFormDataCapped(req).catch(e => e)).code).toBe('too_large')
    expect(s.pulled()).toBe(0)
  })

  it('a normal multipart upload still parses (file + fields)', async () => {
    const fd = new FormData()
    fd.set('file', new File(['hello'], 'a.docx'))
    fd.set('level', 'graduate')
    const parsed = await readFormDataCapped(new Request('http://x', { method: 'POST', body: fd }))
    expect(parsed.get('level')).toBe('graduate')
    expect(await (parsed.get('file') as File).text()).toBe('hello')
  })

  it('every upload route reads the body through the capped reader, never request.formData()', () => {
    for (const r of ['extract-file', 'generate-course-pptx', 'generate-homework-from-file', 'generate-lesson-from-file']) {
      const src = readFileSync(path.join(ROOT, `src/app/api/ai/${r}/route.ts`), 'utf8')
      expect(src, r).toContain('readFormDataCapped(request)')
      expect(src, r).not.toMatch(/request\.formData\(\)/)
    }
  })
})

// ── 2. XML text extraction is linear-time ────────────────────────
describe('DOCX/PPTX tag matching cannot be made quadratic', () => {
  async function zipWith(name: string, entry: string, xml: string) {
    const zip = new JSZip(); zip.file(entry, xml)
    return new File([(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })) as BlobPart], name)
  }
  it.each([
    ['a.pptx', 'ppt/slides/slide1.xml', '<a:t '],
    ['a.docx', 'word/document.xml', '<w:t '],
  ])('%s: 6 MiB of unterminated open tags is processed in well under a second', async (name, entry, tag) => {
    // No '>' anywhere: every open tag is a match attempt that cannot succeed.
    // The old pattern took ~8 s on 200 KB of this input (quadratic), so a 6 MiB
    // file would never finish; the linear pattern takes ~10 ms.
    const hostile = tag.repeat(Math.floor((6 * 1024 * 1024) / tag.length))
    const f = await zipWith(name, entry, hostile)
    const t0 = performance.now()
    await extractTextFromFile(f).catch(() => {})
    expect(performance.now() - t0).toBeLessThan(3000)
  })

  it('still reads tags with attributes and ignores look-alike tags', async () => {
    const xml = '<w:tbl><w:tab/><w:t xml:space="preserve">Kept</w:t><w:t>too</w:t></w:tbl>'
    expect(await extractTextFromFile(await zipWith('b.docx', 'word/document.xml', xml))).toBe('Kept too')
  })
})

// ── 3. PDF parsing is bounded ────────────────────────────────────
describe('PDF text extraction limits', () => {
  const pdfFile = () => new File([new Uint8Array([37, 80, 68, 70, 45])], 'a.pdf')

  it('reads page by page and joins like unpdf mergePages', async () => {
    pdfDoc = { numPages: 2, pageText: n => `Page ${n} text that is long enough to count as a real text layer` }
    const text = await extractTextFromFile(pdfFile(), { vision: false })
    expect(text).toBe('Page 1 text that is long enough to count as a real text layer Page 2 text that is long enough to count as a real text layer')
    expect(destroyed).toHaveBeenCalledOnce()
  })

  it('too many pages: refused before any page is parsed', async () => {
    pdfDoc = { numPages: PDF_MAX_PAGES + 1, pageText: () => 'x' }
    const err = await extractTextFromFile(pdfFile(), { vision: false }).catch(e => e)
    expect(err.code).toBe('too_large')
    expect(getPage).not.toHaveBeenCalled()
    expect(destroyed).toHaveBeenCalledOnce()
  })

  it('too much text: refused, stops reading pages', async () => {
    pdfDoc = { numPages: 50, pageText: () => 'y'.repeat(Math.ceil(PDF_MAX_TEXT_CHARS / 3)) }
    const err = await extractTextFromFile(pdfFile(), { vision: false }).catch(e => e)
    expect(err.code).toBe('too_large')
    expect(getPage.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('time budget: no further page after PDF_MAX_MS', async () => {
    let t = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => t)
    pdfDoc = { numPages: 100, pageText: () => 'z'.repeat(50), onPage: () => { t += PDF_MAX_MS / 3 } }
    const err = await extractTextFromFile(pdfFile(), { vision: false }).catch(e => e)
    expect(err.code).toBe('too_large')
    expect(getPage.mock.calls.length).toBeLessThanOrEqual(4)
  })
})

// ── 4. Provider calls never outlive the request budget ───────────
describe('per-call timeouts are cut to the remaining budget', () => {
  it('callTimeoutMs', () => {
    expect(callTimeoutMs(undefined)).toBe(AI_TIMEOUT_MS)
    expect(callTimeoutMs(1_000 + 5_000, 1_000)).toBe(Math.min(AI_TIMEOUT_MS, 5_000))
    expect(callTimeoutMs(1_000, 5_000)).toBe(1)
  })

  it('aiChatDetailed passes the cut timeout to each provider fetch', async () => {
    vi.stubEnv('GROQ_API_KEY', 'k'); vi.stubEnv('XKIRO_API_KEY', '')
    vi.stubEnv('COHERE_API_KEY', ''); vi.stubEnv('GEMINI_API_KEY', ''); vi.stubEnv('OPENROUTER_API_KEY', '')
    const timeouts: number[] = []
    const real = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { timeouts.push(ms); return real(ms) })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }))
    await aiChatDetailed('p', undefined, { audiences: ['public'], deadline: Date.now() + 4_000 })
    expect(timeouts.at(-1)).toBeLessThanOrEqual(4_000)
    expect(timeouts.at(-1)).toBeGreaterThan(3_000)
  })

  it('no provider is started once the deadline has passed', async () => {
    vi.stubEnv('GROQ_API_KEY', 'k')
    const err = await aiChatDetailed('p', undefined, { audiences: ['public'], deadline: Date.now() - 1 }).catch(e => e)
    expect(err).toMatchObject({ code: 'budget' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 5. Budgets fit inside each route's maxDuration ───────────────
describe('time budgets vs route maxDuration', () => {
  const maxDurationOf = (route: string) => {
    const src = readFileSync(path.join(ROOT, `src/app/api/ai/${route}/route.ts`), 'utf8')
    return Number(src.match(/export const maxDuration = (\d+)/)?.[1]) * 1000
  }
  const USAGE_WRITE_MARGIN_MS = 25_000

  it('lesson-from-file: compose budget + margin <= maxDuration, chunk timeout <= budget', () => {
    expect(COMPOSE_BUDGET_MS + USAGE_WRITE_MARGIN_MS).toBeLessThanOrEqual(maxDurationOf('generate-lesson-from-file'))
    expect(GEMINI_CHUNK_TIMEOUT_MS).toBeLessThanOrEqual(COMPOSE_BUDGET_MS)
  })

  it('homework-from-file: budget + margin <= maxDuration', () => {
    const src = readFileSync(path.join(ROOT, 'src/app/api/ai/generate-homework-from-file/route.ts'), 'utf8')
    const budget = Number(src.match(/HOMEWORK_BUDGET_MS = ([\d_]+)/)?.[1].replace(/_/g, ''))
    expect(budget + USAGE_WRITE_MARGIN_MS).toBeLessThanOrEqual(maxDurationOf('generate-homework-from-file'))
  })

  it('routes without their own maxDuration finish one provider chain inside the 300 s platform ceiling', () => {
    // 5 providers x AI_TIMEOUT_MS, sequential, worst case.
    expect(5 * AI_TIMEOUT_MS).toBeLessThanOrEqual(300_000 - USAGE_WRITE_MARGIN_MS)
  })
})
