import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import JSZip from 'jszip'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { groqChat } from '@/lib/ai/groq'

// gemini-2.0-flash caps a single response around 8192 output tokens (~24k
// chars). Groq's llama-3.3-70b-versatile caps at 4096 — Gemini gives a
// materially larger single-pass ceiling, which is why composition (not just
// vision extraction) now runs through it.
const GEMINI_MODEL = 'gemini-2.0-flash'
const MAX_OUTPUT_TOKENS = 8192

function getGeminiModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  return new GoogleGenerativeAI(key).getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  })
}

// ── Vision extraction (images + scanned/image-only PDFs) ─────────
// Gemini reads the file natively (including scanned pages) and transcribes
// the visible text verbatim — used when there is no selectable text layer.
async function extractWithGeminiVision(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  const model = getGeminiModel()

  const prompt = `Transcribe ALL text visible in this document exactly as written, in the original language and order.
Do not summarize, translate, explain, or add any commentary. Do not skip any page or section.
If there are diagrams or images with labels, transcribe the labels/captions too.
Output only the transcribed text.`

  const data = Buffer.from(buffer).toString('base64')
  const result = await model.generateContent([{ inlineData: { mimeType, data } }, prompt])
  return result.response.text()
}

// ── Text extractors ──────────────────────────────────────────────

async function extractFromPptx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)/)?.[1] ?? '0')
      const nb = parseInt(b.match(/(\d+)/)?.[1] ?? '0')
      return na - nb
    })
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
  if (!doc) throw new Error('word/document.xml not found')
  const xml = await doc.async('string')
  const texts: string[] = []
  for (const m of xml.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g)) {
    const t = m[1].trim(); if (t) texts.push(t)
  }
  return texts.join(' ')
}

async function extractFromPdf(buffer: ArrayBuffer): Promise<string> {
  // unpdf bundles a serverless-ready pdfjs build (no DOMMatrix/canvas
  // dependency), unlike pdf-parse v2 which crashed on Vercel. Gemini vision
  // remains the fallback only for scanned/image-only PDFs with no text layer.
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text } = await extractText(pdf, { mergePages: true })
    if ((text ?? '').replace(/\s/g, '').length < 40) {
      return extractWithGeminiVision(buffer, 'application/pdf')
    }
    return text
  } catch (e) {
    console.error('[extractFromPdf] unpdf failed, falling back to Gemini vision:', e)
    return extractWithGeminiVision(buffer, 'application/pdf')
  }
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

async function extractText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pptx') return extractFromPptx(buffer)
  if (ext === 'docx') return extractFromDocx(buffer)
  if (ext === 'pdf')  return extractFromPdf(buffer)
  if (IMAGE_MIME[ext]) return extractWithGeminiVision(buffer, IMAGE_MIME[ext])
  throw new Error(`Unsupported file type: .${ext}`)
}

// ── Route ────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimit(`lesson-file:${user.id}`, { limit: 10, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let formData: FormData
  try { formData = await request.formData() }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  const customInstructions = (formData.get('instructions') as string | null)?.slice(0, 1000) ?? ''
  const level = (formData.get('level') as string | null) ?? 'undergraduate'

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const supportedExt = ['pptx', 'docx', 'pdf', 'jpg', 'jpeg', 'png', 'webp']
  if (!supportedExt.includes(ext)) {
    return NextResponse.json({ error: 'Only .pptx, .docx, .pdf, .jpg, .jpeg, .png, and .webp files are supported' }, { status: 400 })
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 400 })
  }

  let rawText: string
  try {
    rawText = await extractText(file)
  } catch (e) {
    console.error('[generate-lesson-from-file] extraction:', e)
    const msg = e instanceof Error ? e.message : ''
    // Vision fallback (scanned PDFs / images) died on provider quota — tell
    // the teacher the real cause instead of a generic read failure.
    if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
      return NextResponse.json(
        { error: 'This file has no readable text layer (scanned?) and the vision AI quota is temporarily exhausted. Try a text-based PDF/DOCX/PPTX, or try again later.' },
        { status: 422 }
      )
    }
    return NextResponse.json({ error: 'Failed to read file content.' }, { status: 422 })
  }

  if (!rawText.trim()) {
    return NextResponse.json({ error: 'No text found in file.' }, { status: 422 })
  }

  // No truncation — the teacher asked for the full source content, not a
  // summary, so cutting it at a fixed length would silently drop material.
  const fullText = rawText

  try {
    const content = await composeLesson(fullText, level, customInstructions)
    return NextResponse.json({ content })
  } catch (e) {
    console.error('[generate-lesson-from-file] AI:', e)
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}

// ── Composition (verbatim, lightly formatted) ─────────────────────

function buildPrompt(chunk: string, level: string, customInstructions: string, part?: { index: number; total: number }): string {
  const structureBlock = customInstructions.trim()
    ? `The teacher has provided specific instructions — follow them exactly:\n"""\n${customInstructions}\n"""`
    : `Apply only light, minimal formatting (headings for existing sections, paragraph breaks, bullet points where the source already lists items). Do not invent new sections such as "Learning Objectives" or "Review Questions" unless they already exist in the source.`

  const continuationNote = part && part.index > 0
    ? `\nThis is part ${part.index + 1} of ${part.total} of one longer document, already in progress — continue directly with this part's content. Do not repeat a title or restart with an introduction.`
    : ''

  return `You are transcribing a teacher's source material into a lesson page.
Reproduce the SAME content as the source — do not add information, examples, questions, or explanations that are not present in it, and do not omit or shorten any part of it.
Keep the same language as the source material.

Level: ${level}
${structureBlock}${continuationNote}

Format in Markdown.

Source content:
${chunk}`
}

// Splits on paragraph boundaries (never mid-sentence) once a chunk would
// approach Gemini's output ceiling, so long documents (~20+ pages) still
// come back complete instead of being cut off silently.
const CHUNK_CHAR_TARGET = 14000
// Groq's llama-3.3-70b caps output at 4096 tokens, so its chunks must be
// smaller than Gemini's for the output to fit without truncation.
const GROQ_CHUNK_CHAR_TARGET = 8000

function splitIntoChunks(text: string, target: number): string[] {
  if (text.length <= target) return [text]

  const paragraphs = text.split(/\n\s*\n/)
  const chunks: string[] = []
  let current = ''
  for (const p of paragraphs) {
    if (current && (current.length + p.length) > target) {
      chunks.push(current)
      current = p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current) chunks.push(current)
  return chunks
}

async function composeWithGemini(fullText: string, level: string, customInstructions: string): Promise<string> {
  const chunks = splitIntoChunks(fullText, CHUNK_CHAR_TARGET)
  const model = getGeminiModel()

  if (chunks.length === 1) {
    const result = await model.generateContent(buildPrompt(chunks[0], level, customInstructions))
    return result.response.text()
  }

  // Long document: process each chunk independently (in order) and stitch
  // the results into one continuous lesson.
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const result = await model.generateContent(
      buildPrompt(chunks[i], level, customInstructions, { index: i, total: chunks.length })
    )
    parts.push(result.response.text())
  }
  return parts.join('\n\n')
}

async function composeWithGroq(fullText: string, level: string, customInstructions: string): Promise<string> {
  const chunks = splitIntoChunks(fullText, GROQ_CHUNK_CHAR_TARGET)
  const system = 'You transcribe source material into Markdown lesson pages faithfully, without adding or omitting content.'

  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? { index: i, total: chunks.length } : undefined
    parts.push(await groqChat(buildPrompt(chunks[i], level, customInstructions, part), system))
  }
  return parts.join('\n\n')
}

async function composeLesson(fullText: string, level: string, customInstructions: string): Promise<string> {
  // Gemini first (larger output window), Groq as fallback — e.g. when the
  // Gemini free-tier quota is exhausted (429) the teacher still gets a lesson.
  try {
    return await composeWithGemini(fullText, level, customInstructions)
  } catch (e) {
    console.error('[composeLesson] Gemini failed, falling back to Groq:', e instanceof Error ? e.message : e)
    return composeWithGroq(fullText, level, customInstructions)
  }
}
