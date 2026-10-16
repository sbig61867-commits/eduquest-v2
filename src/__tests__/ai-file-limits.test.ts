// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

const generateContent = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent } } },
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import {
  EXTRACT_MAX_BYTES, ExtractionError, UPLOAD_MAX_REQUEST_BYTES, ZIP_MAX_ENTRIES, ZIP_MAX_UNZIPPED_BYTES,
  extractTextFromFile, extractionErrorResponse, uploadRequestTooLarge,
} from '@/lib/ai/extract'

beforeEach(() => generateContent.mockReset())

async function zipFile(name: string, entries: Record<string, string | Uint8Array>, level = 9): Promise<File> {
  const zip = new JSZip()
  for (const [k, v] of Object.entries(entries)) zip.file(k, v)
  const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level } })
  return new File([buf as BlobPart], name)
}
const codeOf = async (p: Promise<unknown>) => ((await p.catch(e => e)) as ExtractionError).code

describe('upload size', () => {
  it('the limit is 4 MiB exactly', () => {
    expect(EXTRACT_MAX_BYTES).toBe(4 * 1024 * 1024)
  })

  it('a file of exactly 4 MiB passes the size check (then fails as not-a-zip, not as too large)', async () => {
    const f = new File([new Uint8Array(EXTRACT_MAX_BYTES)], 'a.docx')
    expect(await codeOf(extractTextFromFile(f))).toBe('unreadable')
  })

  it('one byte over 4 MiB is too large, 413, before any parsing', async () => {
    const f = new File([new Uint8Array(EXTRACT_MAX_BYTES + 1)], 'a.docx')
    const err = await extractTextFromFile(f).catch(e => e)
    expect(err.code).toBe('too_large')
    expect((await extractionErrorResponse(err)).status).toBe(413)
  })

  it('an empty file is refused as empty', async () => {
    expect(await codeOf(extractTextFromFile(new File([], 'a.docx')))).toBe('empty')
  })

  it('an unsupported type is refused without reading it', async () => {
    expect(await codeOf(extractTextFromFile(new File(['x'], 'a.exe')))).toBe('unsupported')
  })

  it('a declared body over the request bound is refused before formData()', () => {
    const mk = (len?: number) => new Request('http://x', { method: 'POST', headers: len === undefined ? {} : { 'content-length': String(len) } })
    expect(uploadRequestTooLarge(mk(UPLOAD_MAX_REQUEST_BYTES + 1))).toBe(true)
    expect(uploadRequestTooLarge(mk(UPLOAD_MAX_REQUEST_BYTES))).toBe(false)
    expect(uploadRequestTooLarge(mk(1000))).toBe(false)
    expect(uploadRequestTooLarge(mk())).toBe(false) // no header: platform limit + per-file check apply
  })
})

describe('DOCX / PPTX decompression is bounded', () => {
  it('a normal DOCX and PPTX still extract', async () => {
    expect(await extractTextFromFile(await zipFile('a.docx', { 'word/document.xml': '<w:t>One</w:t><w:t>Two</w:t>' }))).toBe('One Two')
    const pptx = await zipFile('a.pptx', {
      'ppt/slides/slide2.xml': '<a:t>Second</a:t>',
      'ppt/slides/slide1.xml': '<a:t>First</a:t>',
    })
    expect(await extractTextFromFile(pptx)).toBe('[Slide 1]: First\n[Slide 2]: Second')
  })

  it('a DOCX whose document.xml inflates past the cap is refused (zip bomb)', async () => {
    // ~33 MiB of one repeated byte compresses to a few tens of KiB.
    const bomb = new Uint8Array(ZIP_MAX_UNZIPPED_BYTES + 1024 * 1024).fill(0x41)
    const f = await zipFile('bomb.docx', { 'word/document.xml': bomb })
    expect(f.size).toBeLessThan(EXTRACT_MAX_BYTES)
    expect(await codeOf(extractTextFromFile(f))).toBe('too_large')
  })

  it('PPTX slides share one budget: many medium slides past the cap are refused', async () => {
    const slide = new Uint8Array(8 * 1024 * 1024).fill(0x42)
    const entries: Record<string, Uint8Array> = {}
    for (let i = 1; i <= 5; i++) entries[`ppt/slides/slide${i}.xml`] = slide // 40 MiB total
    expect(await codeOf(extractTextFromFile(await zipFile('many.pptx', entries)))).toBe('too_large')
  })

  it('too many zip entries are refused before inflating any of them', async () => {
    const entries: Record<string, string> = {}
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i++) entries[`x/${i}.txt`] = ''
    entries['word/document.xml'] = '<w:t>a</w:t>'
    expect(await codeOf(extractTextFromFile(await zipFile('wide.docx', entries, 1)))).toBe('too_large')
  })

  it('a corrupt zip is unreadable, not a crash', async () => {
    expect(await codeOf(extractTextFromFile(new File([new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9])], 'x.pptx')))).toBe('unreadable')
  })

  it('a DOCX without word/document.xml is unreadable', async () => {
    expect(await codeOf(extractTextFromFile(await zipFile('x.docx', { 'other.xml': '<a/>' })))).toBe('unreadable')
  })

  it('no file is ever sent to a provider on the local path', () => {
    expect(generateContent).not.toHaveBeenCalled()
  })
})
