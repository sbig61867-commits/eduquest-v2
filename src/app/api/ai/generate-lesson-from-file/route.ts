import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import JSZip from 'jszip'
import { groqChat } from '@/lib/ai/groq'
import { GoogleGenerativeAI } from '@google/generative-ai'

// ── Vision extraction (images + scanned/image-only PDFs) ─────────
// Gemini reads the file natively (including scanned pages) and transcribes
// the visible text verbatim — used when there is no selectable text layer.
async function extractWithGeminiVision(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: 'gemini-2.0-flash' })

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
  // pdf-parse v2: class-based API (no default export function)
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: Buffer.from(buffer) })
  const result = await parser.getText()
  const text = result.text ?? ''
  // A scanned/image-only PDF has no selectable text layer — pdf-parse returns
  // near-nothing (page markers/whitespace) in that case. Fall back to Gemini
  // vision, which reads the rendered pages directly.
  if (text.replace(/\s/g, '').length < 40) {
    return extractWithGeminiVision(buffer, 'application/pdf')
  }
  return text
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
    return NextResponse.json({ error: 'Failed to read file content.' }, { status: 422 })
  }

  if (!rawText.trim()) {
    return NextResponse.json({ error: 'No text found in file.' }, { status: 422 })
  }

  // No truncation — the teacher asked for the full source content, not a
  // summary, so cutting it at a fixed length would silently drop material.
  const fullText = rawText

  const structureBlock = customInstructions.trim()
    ? `The teacher has provided specific instructions — follow them exactly:\n"""\n${customInstructions}\n"""`
    : `Apply only light, minimal formatting (headings for existing sections, paragraph breaks, bullet points where the source already lists items). Do not invent new sections such as "Learning Objectives" or "Review Questions" unless they already exist in the source.`

  const prompt = `You are transcribing a teacher's source material into a lesson page.
Reproduce the SAME content as the source — do not add information, examples, questions, or explanations that are not present in it, and do not omit or shorten any part of it.
Keep the same language as the source material.

Level: ${level}

${structureBlock}

Format in Markdown.

Source content:
${fullText}`

  try {
    const content = await groqChat(prompt, 'Transcribe the source content faithfully in Markdown. Do not add or remove information.')
    return NextResponse.json({ content })
  } catch (e) {
    console.error('[generate-lesson-from-file] AI:', e)
    // Groq's context window can be exceeded by very long source documents.
    const msg = e instanceof Error ? e.message.toLowerCase() : ''
    if (msg.includes('context') || msg.includes('too long') || msg.includes('413')) {
      return NextResponse.json(
        { error: 'The file is too long for the AI to process in one pass. Try splitting it into smaller files.' },
        { status: 413 }
      )
    }
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}
