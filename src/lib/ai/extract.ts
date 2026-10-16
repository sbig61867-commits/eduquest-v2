import JSZip from 'jszip'
import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { AiProviderError, geminiProviderError, geminiUsage, logAiFailure, meterCall } from './meter'
import { PrivacyPendingError } from './privacy'

// ── Unified file-content extraction ──────────────────────────────
// Single entry point for every "teacher uploads a file" feature
// (lesson-from-file, course-from-file, …). Handles PPTX/DOCX/PDF/images,
// with Gemini vision as the fallback for scanned/image-only content.
//
// Uploaded files are institutional content: the vision call is made with the
// `institution` audience, so it is refused before any request unless Gemini is
// approved for it (privacy.ts). Local parsing (DOCX, PPTX, PDF text layer)
// never leaves the server.

export const EXTRACT_SUPPORTED_EXTS = ['pptx', 'docx', 'pdf', 'jpg', 'jpeg', 'png', 'webp'] as const
// Vercel rejects request bodies above 4.5 MB before our code runs. 4 MiB leaves
// room for the multipart envelope and the other form fields.
export const EXTRACT_MAX_BYTES = 4 * 1024 * 1024
// Upper bound for a whole multipart request carrying one file.
export const UPLOAD_MAX_REQUEST_BYTES = EXTRACT_MAX_BYTES + 256 * 1024

// Limits for DOCX/PPTX (zip) after decompression. A small zip can expand to
// gigabytes; these bound memory and CPU no matter what the headers claim.
export const ZIP_MAX_ENTRIES = 5000
export const ZIP_MAX_SLIDES = 1000
export const ZIP_MAX_UNZIPPED_BYTES = 32 * 1024 * 1024

// Limits for PDF text extraction. pdf.js inflates each page's content streams,
// so pages are read one at a time, and reading stops at whichever limit is hit
// first. A single hostile page can still be costly; see AI_HARDENING_PROGRESS.md.
export const PDF_MAX_PAGES = 500
export const PDF_MAX_TEXT_CHARS = 2_000_000
export const PDF_MAX_MS = 20_000

export type ExtractionErrorCode = 'unsupported' | 'too_large' | 'vision_quota' | 'unreadable' | 'empty' | 'privacy_pending'

export class ExtractionError extends Error {
  /**
   * `message` is a developer-facing log line and never carries file or provider
   * text. What the USER reads comes from the `errors` message namespace via
   * extractionErrorResponse(), keyed by `userCode` (defaults per `code`).
   */
  constructor(
    public code: ExtractionErrorCode,
    message: string,
    public userCode?: ApiErrorCode,
    public params?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }
}

const USER_CODE: Record<ExtractionErrorCode, ApiErrorCode> = {
  unsupported: 'fileTypeUnsupported',
  too_large: 'fileTooLarge',
  vision_quota: 'fileVisionQuota',
  empty: 'fileEmpty',
  unreadable: 'fileUnreadable',
  privacy_pending: 'aiPrivacyPending',
}
const STATUS: Record<ExtractionErrorCode, number> = {
  unsupported: 400, too_large: 413, vision_quota: 422, empty: 422, unreadable: 422, privacy_pending: 503,
}

/** Maps an ExtractionError to an HTTP status + a message in the caller's language. */
export async function extractionErrorResponse(e: unknown): Promise<{ status: number; error: string; code: ApiErrorCode }> {
  if (e instanceof ExtractionError) {
    return { status: STATUS[e.code], ...(await apiErr(e.userCode ?? USER_CODE[e.code], e.params)) }
  }
  return { status: 422, ...(await apiErr('fileUnreadable')) }
}

/** True when the request DECLARES a body larger than one upload may be. */
export function uploadRequestTooLarge(request: Request, maxBytes = UPLOAD_MAX_REQUEST_BYTES): boolean {
  const len = Number(request.headers.get('content-length'))
  return Number.isFinite(len) && len > maxBytes
}

/**
 * Parses a multipart upload while never holding more than `maxBytes` of body.
 * request.formData() buffers the whole body first; this reads the stream and
 * counts the bytes actually received, so a missing (chunked) or understated
 * Content-Length cannot get past the cap, and the platform's own body limit is
 * not relied on. Throws ExtractionError('too_large') over the cap; any other
 * parse failure is thrown as is (the route answers 400).
 */
export async function readFormDataCapped(request: Request, maxBytes = UPLOAD_MAX_REQUEST_BYTES): Promise<FormData> {
  if (uploadRequestTooLarge(request, maxBytes)) throw new ExtractionError('too_large', 'Request body too large')
  if (!request.body) return request.formData()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new ExtractionError('too_large', 'Request body too large')
    }
    chunks.push(value)
  }
  return new Response(Buffer.concat(chunks), {
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
  }).formData()
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

/** Extension of a file name, lowercased. */
export function fileExt(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

export function isImageExt(ext: string): boolean {
  return ext in IMAGE_MIME
}

// ── Gemini vision (scanned PDFs / images) ────────────────────────

async function extractWithGeminiVision(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  const prompt = `Transcribe ALL text visible in this document exactly as written, in the original language and order.
Do not summarize, translate, explain, or add any commentary. Do not skip any page or section.
If there are diagrams or images with labels, transcribe the labels/captions too.
Output only the transcribed text.`

  try {
    // Metered as a Gemini call: an uploaded page is billed as input tokens.
    // The file is institutional content: meterCall() refuses it before any
    // request unless Gemini is approved for it.
    return await meterCall('gemini', 'gemini-2.5-flash', prompt.length, ['institution'], async () => {
      const key = process.env.GEMINI_API_KEY
      if (!key || key === 'your_gemini_api_key_here') throw new AiProviderError('gemini', 'not_configured')
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const { AI_TIMEOUT_MS } = await import('./timeout')
      // gemini-2.0-flash was retired by Google (404) — gemini-2.5-flash is the
      // current stable free-tier model, verified live.
      const model = new GoogleGenerativeAI(key).getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 8192 },
      }, { timeout: AI_TIMEOUT_MS })
      const data = Buffer.from(buffer).toString('base64')
      let result
      let text: string
      try {
        result = await model.generateContent([{ inlineData: { mimeType, data } }, prompt])
        text = result.response.text()
      } catch (e) {
        throw geminiProviderError(e)
      }
      return { value: text, ...geminiUsage(result.response), outputChars: text.length }
    })
  } catch (e) {
    if (e instanceof PrivacyPendingError) {
      throw new ExtractionError('privacy_pending', 'Vision extraction blocked: provider not approved for institutional files', 'aiPrivacyPending')
    }
    const code = e instanceof AiProviderError ? e.code : 'error'
    if (code === 'not_configured') throw new ExtractionError('vision_quota', 'Vision extraction unavailable: not configured')
    if (code === '429') throw new ExtractionError('vision_quota', 'Vision extraction quota: 429')
    throw new ExtractionError('unreadable', `Vision extraction failed: ${code}`)
  }
}

// ── Bounded zip reading (DOCX / PPTX) ────────────────────────────

/** Shared decompression budget for one file. */
interface UnzipBudget { remaining: number }

async function loadZip(buffer: ArrayBuffer): Promise<JSZip> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new ExtractionError('unreadable', 'Not a readable zip container')
  }
  if (Object.keys(zip.files).length > ZIP_MAX_ENTRIES) {
    throw new ExtractionError('too_large', 'Zip has too many entries')
  }
  return zip
}

/**
 * Inflates one entry as UTF-8, stopping as soon as the shared budget is spent.
 * The declared uncompressed size is not trusted: bytes are counted as they are
 * produced, so a zip bomb is cut off after at most `budget.remaining` bytes.
 */
function readEntryCapped(entry: JSZip.JSZipObject, budget: UnzipBudget): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let done = false
    // internalStream is public JSZip API (3.x) but missing from its type definitions.
    const stream = (entry as unknown as { internalStream(type: 'uint8array'): {
      on(ev: 'data', fn: (chunk: Uint8Array) => void): unknown
      on(ev: 'error', fn: (e: unknown) => void): unknown
      on(ev: 'end', fn: () => void): unknown
      pause(): unknown
      resume(): unknown
    } }).internalStream('uint8array')
    stream.on('data', (chunk: Uint8Array) => {
      if (done) return
      budget.remaining -= chunk.length
      if (budget.remaining < 0) {
        done = true
        stream.pause()
        reject(new ExtractionError('too_large', 'Decompressed content exceeds the limit'))
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', () => {
      if (done) return
      done = true
      reject(new ExtractionError('unreadable', 'Corrupt zip entry'))
    })
    stream.on('end', () => {
      if (done) return
      done = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    stream.resume()
  })
}

// ── Per-format extractors ────────────────────────────────────────

async function extractFromPptx(buffer: ArrayBuffer): Promise<string> {
  const zip = await loadZip(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (parseInt(a.match(/(\d+)/)?.[1] ?? '0') - parseInt(b.match(/(\d+)/)?.[1] ?? '0')))
  if (slideFiles.length > ZIP_MAX_SLIDES) throw new ExtractionError('too_large', 'Too many slides')
  const budget: UnzipBudget = { remaining: ZIP_MAX_UNZIPPED_BYTES }
  const parts: string[] = []
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await readEntryCapped(zip.files[slideFiles[i]], budget)
    const texts: string[] = []
    for (const m of xml.matchAll(/<a:t(?:\s[^<>]*)?>([^<]+)<\/a:t>/g)) {
      const t = m[1].trim(); if (t) texts.push(t)
    }
    if (texts.length) parts.push(`[Slide ${i + 1}]: ${texts.join(' ')}`)
  }
  return parts.join('\n')
}

async function extractFromDocx(buffer: ArrayBuffer): Promise<string> {
  const zip = await loadZip(buffer)
  const doc = zip.files['word/document.xml']
  if (!doc) throw new ExtractionError('unreadable', 'word/document.xml not found in DOCX')
  const xml = await readEntryCapped(doc, { remaining: ZIP_MAX_UNZIPPED_BYTES })
  const texts: string[] = []
  for (const m of xml.matchAll(/<w:t(?:\s[^<>]*)?>([^<]+)<\/w:t>/g)) {
    const t = m[1].trim(); if (t) texts.push(t)
  }
  return texts.join(' ')
}

/** The text layer of a PDF, page by page, within PDF_MAX_PAGES / _TEXT_CHARS / _MS.
 *  Same output as unpdf's extractText(pdf, { mergePages: true }). */
async function pdfTextLayer(buffer: ArrayBuffer, now: () => number = Date.now): Promise<string> {
  const { getDocumentProxy } = await import('unpdf')
  const started = now()
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  try {
    if (pdf.numPages > PDF_MAX_PAGES) throw new ExtractionError('too_large', 'PDF has too many pages')
    const pages: string[] = []
    let chars = 0
    for (let n = 1; n <= pdf.numPages; n++) {
      if (now() - started > PDF_MAX_MS) throw new ExtractionError('too_large', 'PDF took too long to read')
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      const text = content.items
        .map(item => ('str' in item && item.str != null ? item.str + (item.hasEOL ? '\n' : '') : ''))
        .join('')
      page.cleanup()
      chars += text.length
      if (chars > PDF_MAX_TEXT_CHARS) throw new ExtractionError('too_large', 'PDF text too long')
      pages.push(text)
    }
    return pages.join('\n').replace(/\s+/g, ' ')
  } finally {
    await pdf.destroy().catch(() => {})
  }
}

async function extractFromPdf(buffer: ArrayBuffer, vision: boolean): Promise<string> {
  // unpdf bundles a serverless-ready pdfjs build (no DOMMatrix/canvas
  // dependency) — works on Vercel where pdf-parse v2 crashed.
  try {
    const text = await pdfTextLayer(buffer)
    // A near-empty text layer means a scanned/image-only PDF.
    if (text.replace(/\s/g, '').length < 40) {
      if (!vision) throw new ExtractionError('empty', 'PDF has no text layer', 'fileScannedUnsupported')
      return extractWithGeminiVision(buffer, 'application/pdf')
    }
    return text
  } catch (e) {
    if (e instanceof ExtractionError) throw e
    logAiFailure('[extract] unpdf failed:', e)
    if (!vision) throw new ExtractionError('unreadable', 'Could not read this PDF')
    return extractWithGeminiVision(buffer, 'application/pdf')
  }
}

// ── Entry point ──────────────────────────────────────────────────

export interface ExtractOptions {
  /** Allow Gemini vision fallback for scanned PDFs and image files (default true).
   *  Vision still runs only if Gemini is approved for institutional content. */
  vision?: boolean
}

/**
 * Extracts text from a teacher-uploaded file. Validates extension and size,
 * throws ExtractionError with a typed code on any failure — pass it to
 * extractionErrorResponse() for the HTTP reply.
 */
export async function extractTextFromFile(file: File, opts: ExtractOptions = {}): Promise<string> {
  const vision = opts.vision !== false
  const ext = fileExt(file.name)

  if (!(EXTRACT_SUPPORTED_EXTS as readonly string[]).includes(ext)) {
    const allowed = EXTRACT_SUPPORTED_EXTS.map(e => '.' + e).join(', ')
    throw new ExtractionError('unsupported', 'Unsupported file type', 'fileTypeUnsupported', { ext, allowed })
  }
  if (IMAGE_MIME[ext] && !vision) {
    throw new ExtractionError('unsupported', 'Image files are not supported for this feature', 'fileImagesUnsupported')
  }
  if (file.size > EXTRACT_MAX_BYTES) {
    throw new ExtractionError('too_large', 'File too large')
  }
  if (file.size === 0) throw new ExtractionError('empty', 'Empty file')

  const buffer = await file.arrayBuffer()
  // File.size is the size of the parsed part; re-check the bytes actually read.
  if (buffer.byteLength > EXTRACT_MAX_BYTES) throw new ExtractionError('too_large', 'File too large')
  let text: string
  if (ext === 'pptx') text = await extractFromPptx(buffer)
  else if (ext === 'docx') text = await extractFromDocx(buffer)
  else if (ext === 'pdf') text = await extractFromPdf(buffer, vision)
  else text = await extractWithGeminiVision(buffer, IMAGE_MIME[ext])

  if (!text.trim()) throw new ExtractionError('empty', 'No text found in file')
  return text
}
