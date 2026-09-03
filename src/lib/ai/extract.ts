import JSZip from 'jszip'

// ── Unified file-content extraction ──────────────────────────────
// Single entry point for every "teacher uploads a file" feature
// (lesson-from-file, course-from-file, …). Handles PPTX/DOCX/PDF/images,
// with Gemini vision as the fallback for scanned/image-only content.

export const EXTRACT_SUPPORTED_EXTS = ['pptx', 'docx', 'pdf', 'jpg', 'jpeg', 'png', 'webp'] as const
export const EXTRACT_MAX_BYTES = 20 * 1024 * 1024

export type ExtractionErrorCode = 'unsupported' | 'too_large' | 'vision_quota' | 'unreadable' | 'empty'

export class ExtractionError extends Error {
  constructor(public code: ExtractionErrorCode, message: string) {
    super(message)
    this.name = 'ExtractionError'
  }
}

/** Maps an ExtractionError to an HTTP status + user-facing message (English, matches existing route copy). */
export function extractionErrorResponse(e: unknown): { status: number; error: string } {
  if (e instanceof ExtractionError) {
    switch (e.code) {
      case 'unsupported': return { status: 400, error: e.message }
      case 'too_large':   return { status: 400, error: 'File too large (max 20 MB)' }
      case 'vision_quota':return { status: 422, error: 'This file has no readable text layer (scanned?) and the vision AI quota is temporarily exhausted. Try a text-based PDF/DOCX/PPTX, or try again later.' }
      case 'empty':       return { status: 422, error: 'No text could be extracted from this file. It may be image-only or empty.' }
      case 'unreadable':  return { status: 422, error: 'Failed to read file content. Make sure it is a valid and non-corrupted file.' }
    }
  }
  return { status: 422, error: 'Failed to read file content.' }
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
  // gemini-2.0-flash was retired by Google (404) — gemini-2.5-flash is the
  // current stable free-tier model, verified live.
  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { maxOutputTokens: 8192 },
  })

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
    if (texts.length) parts.push(`[الشريحة ${i + 1}]: ${texts.join(' ')}`)
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
    throw new ExtractionError('unsupported', `Unsupported file type: .${ext}. Please upload ${EXTRACT_SUPPORTED_EXTS.map(e => '.' + e).join(', ')}`)
  }
  if (IMAGE_MIME[ext] && !vision) {
    throw new ExtractionError('unsupported', 'Image files are not supported for this feature')
  }
  if (file.size > EXTRACT_MAX_BYTES) {
    throw new ExtractionError('too_large', 'File too large (max 20 MB)')
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
