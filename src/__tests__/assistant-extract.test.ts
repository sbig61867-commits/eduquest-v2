import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import JSZip from 'jszip'

// Extraction as the assistant will use it: vision off, so no file reaches a provider.

vi.mock('@/lib/api-error', () => ({
  apiErr: async (code: string) => ({ error: code, code }),
}))

import { extractTextFromFile, ExtractionError } from '@/lib/ai/extract'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => { throw new Error('no network in tests') })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function zipFile(name: string, entries: Record<string, string>): Promise<File> {
  const zip = new JSZip()
  for (const [path, xml] of Object.entries(entries)) zip.file(path, xml)
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return new File([buf], name)
}

describe('assistant extraction with vision off', () => {
  it('reads a DOCX locally, Arabic included', async () => {
    const file = await zipFile('lesson.docx', {
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>مرحبا بالخلية</w:t></w:r></w:p></w:body></w:document>',
    })
    const text = await extractTextFromFile(file, { vision: false })
    expect(text).toContain('مرحبا بالخلية')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads a PPTX locally, slide by slide', async () => {
    const file = await zipFile('deck.pptx', {
      'ppt/slides/slide1.xml': '<p:sld><a:t>Cells</a:t></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:t>Membranes</a:t></p:sld>',
    })
    const text = await extractTextFromFile(file, { vision: false })
    expect(text).toContain('[Slide 1]: Cells')
    expect(text).toContain('[Slide 2]: Membranes')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a PDF with no text layer, without calling any provider', async () => {
    const pdf = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
    ].join('\n')
    const file = new File([pdf], 'scan.pdf', { type: 'application/pdf' })
    const err = await extractTextFromFile(file, { vision: false }).catch(e => e)
    expect(err).toBeInstanceOf(ExtractionError)
    expect(['empty', 'unreadable']).toContain(err.code)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an image without calling any provider', async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'figure.png', { type: 'image/png' })
    const err = await extractTextFromFile(file, { vision: false }).catch(e => e)
    expect(err).toBeInstanceOf(ExtractionError)
    expect(err.code).toBe('unsupported')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
