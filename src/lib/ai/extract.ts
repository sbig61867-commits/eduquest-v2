import JSZip from 'jszip'
import { apiErr, type ApiErrorCode } from '@/lib/api-error'

// ── Unified file-content extraction ──────────────────────────────
// Single entry point for every "teacher uploads a file" feature
// (lesson-from-file, course-from-file, …). Handles PPTX/DOCX/PDF/images,
// with Gemini vision as the fallback for scanned/image-only content.

export const EXTRACT_SUPPORTED_EXTS = ['pptx', 'docx', 'pdf', 'jpg', 'jpeg', 'png', 'webp'] as const
export const EXTRACT_MAX_BYTES = 20 * 1024 * 1024

export type ExtractionErrorCode = 'unsupported' | 'too_large' | 'vision_quota' | 'unreadable' | 'empty'

export class ExtractionError extends Error {
  /**
   * `message` is a developer-facing log line. What the USER reads comes from
   * the `errors` message namespace via extractionErrorResponse(), keyed by
   * `userCode` (defaults per `code`) so it follows the caller's language.
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
}
const STATUS: Record<ExtractionErrorCode, number> = {
  unsupported: 400, too_large: 400, vision_quota: 422, empty: 422, unreadable: 422,
}

/** Maps an ExtractionError to an HTTP status + a message in the caller's language. */
export async function extractionErrorResponse(e: unknown): Promise<{ status: number; error: string; code: ApiErrorCode }> {
  if (e instanceof ExtractionError) {
    return { status: STATUS[e.code], ...(await apiErr(e.userCode ?? USER_CODE[e.code], e.params)) }
  }
  return { status: 422, ...(await apiErr('fileUnreadable')) }
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

// ── Gemini vision (scanned PDFs / images) ────────────────────────

async function extractWithGeminiVision(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key || key === 'your_gemini_api_key_here') {
    throw new ExtractionError('vision_quota', 'Vision extraction unavailable (GEMINI_API_KEY not configured)')
  }
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const { AI_TIMEOUT_MS } = await import('./timeout')
  // gemini-2.0-flash was retired by Google (404) — gemini-2.5-flash is the
  // current stable free-tier model, verified live.
  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { maxOutputTokens: 8192 },
  }, { timeout: AI_TIMEOUT_MS })

  const prompt = `Transcribe ALL text visible in this document exactly as written, in the original language and order.
Do not summarize, translate, explain, or add any commentary. Do not skip any page or section.
If there are diagrams or images with labels, transcribe the labels/captions too.
Output only the transcribed text.`

  try {
    const data = Buffer.from(buffer).toString('base64')
    const result = await model.generateContent([{ inlineData: { mimeType, data } }, prompt])
    return result.response.text()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
      throw new ExtractionError('vision_quota', msg)
    }
    throw new ExtractionError('unreadable', msg)
  }
}

// ── Per-format extractors ────────────────────────────────────────

async function extractFromPptx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (parseInt(a.match(/(\d+)/)?.[1] ?? '0') - parseInt(b.match(/(\d+)/)?.[1] ?? '0')))
  const parts: string[] = []
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string')
    const texts: string[] = []
    for (const m of xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)) {
      const t = m[1].trim(); if (t) texts.push(t)
    }
    if (texts.length) parts.push(`[Slide ${i + 1}]: ${texts.join(' ')}`)
  }
  return parts.join('\n')
}

async function extractFromDocx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const doc = zip.files['word/document.xml']
  if (!doc) throw new ExtractionError('unreadable', 'word/document.xml not found in DOCX')
  const xml = await doc.async('string')
  const texts: string[] = []
  for (const m of xml.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g)) {
    const t = m[1].trim(); if (t) texts.push(t)
  }
  return texts.join(' ')
}

async function extractFromPdf(buffer: ArrayBuffer, vision: boolean): Promise<string> {
  // unpdf bundles a serverless-ready pdfjs build (no DOMMatrix/canvas
  // dependency) — works on Vercel where pdf-parse v2 crashed.
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text } = await extractText(pdf, { mergePages: true })
    // A near-empty text layer means a scanned/image-only PDF.
    if ((text ?? '').replace(/\s/g, '').length < 40) {
      if (!vision) throw new ExtractionError('empty', 'PDF has no text layer')
      return extractWithGeminiVision(buffer, 'application/pdf')
    }
    return text
  } catch (e) {
    if (e instanceof ExtractionError) throw e
    console.error('[extract] unpdf failed:', e)
    if (!vision) throw new ExtractionError('unreadable', 'Could not read this PDF')
    return extractWithGeminiVision(buffer, 'application/pdf')
  }
}

// ── Entry point ──────────────────────────────────────────────────

export interface ExtractOptions {
  /** Allow Gemini vision fallback for scanned PDFs and image files (default true). */
  vision?: boolean
}

/**
 * Extracts text from a teacher-uploaded file. Validates extension and size,
 * throws ExtractionError with a typed code on any failure — pass it to
 * extractionErrorResponse() for the HTTP reply.
 */
export async function extractTextFromFile(file: File, opts: ExtractOptions = {}): Promise<string> {
  const vision = opts.vision !== false
  const ext = file.name.toLowerCase().split('.').pop() ?? ''

  if (!(EXTRACT_SUPPORTED_EXTS as readonly string[]).includes(ext)) {
    const allowed = EXTRACT_SUPPORTED_EXTS.map(e => '.' + e).join(', ')
    throw new ExtractionError('unsupported', `Unsupported file type: .${ext}`, 'fileTypeUnsupported', { ext, allowed })
  }
  if (IMAGE_MIME[ext] && !vision) {
    throw new ExtractionError('unsupported', 'Image files are not supported for this feature', 'fileImagesUnsupported')
  }
  if (file.size > EXTRACT_MAX_BYTES) {
    throw new ExtractionError('too_large', `File too large: ${file.size} bytes`)
  }

  const buffer = await file.arrayBuffer()
  let text: string
  if (ext === 'pptx') text = await extractFromPptx(buffer)
  else if (ext === 'docx') text = await extractFromDocx(buffer)
  else if (ext === 'pdf') text = await extractFromPdf(buffer, vision)
  else text = await extractWithGeminiVision(buffer, IMAGE_MIME[ext])

  if (!text.trim()) throw new ExtractionError('empty', 'No text found in file')
  return text
}
