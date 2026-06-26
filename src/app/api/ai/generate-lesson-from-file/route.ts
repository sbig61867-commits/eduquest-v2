import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import JSZip from 'jszip'
import { groqChat } from '@/lib/ai/groq'

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('pdf-parse') as any
  const pdfParse = mod.default ?? mod
  const data = await pdfParse(Buffer.from(buffer))
  return data.text
}

async function extractText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'pptx') return extractFromPptx(buffer)
  if (ext === 'docx') return extractFromDocx(buffer)
  if (ext === 'pdf')  return extractFromPdf(buffer)
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

  const ext = file.name.toLowerCase().split('.').pop()
  if (!['pptx', 'docx', 'pdf'].includes(ext ?? '')) {
    return NextResponse.json({ error: 'Only .pptx, .docx, and .pdf files are supported' }, { status: 400 })
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
    return NextResponse.json({ error: 'No text found in file. It may be image-only.' }, { status: 422 })
  }

  const truncated = rawText.slice(0, 8000)

  const structureBlock = customInstructions.trim()
    ? `The teacher has provided specific instructions — follow them exactly:\n"""\n${customInstructions}\n"""`
    : `Structure the lesson with:
1. Learning Objectives (3-5 bullet points)
2. Introduction
3. Main Content (broken into clear sections with headings)
4. Key Concepts Summary
5. 3 Review Questions`

  const prompt = `You are an educational content writer.
A teacher uploaded a file with academic content. Create a comprehensive lesson based ONLY on this content.
Do NOT add information not present in the source. Keep the same language as the source material.

Level: ${level}

${structureBlock}

Format in Markdown.

Source content:
${truncated}`

  try {
    const content = await groqChat(prompt, 'Write educational lesson content in Markdown. Base it strictly on the provided source.')
    return NextResponse.json({ content })
  } catch (e) {
    console.error('[generate-lesson-from-file] AI:', e)
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}
