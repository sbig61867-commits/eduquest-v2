import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import JSZip from 'jszip'
import { groqChat } from '@/lib/ai/groq'

// ── Text extractors ──────────────────────────────────────────────

function extractTextFromPptx(xml: string): string {
  const texts: string[] = []
  for (const m of xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)) {
    const t = m[1].trim()
    if (t) texts.push(t)
  }
  return texts.join(' ')
}

function extractTextFromDocx(xml: string): string {
  const texts: string[] = []
  for (const m of xml.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g)) {
    const t = m[1].trim()
    if (t) texts.push(t)
  }
  // Join paragraphs with newlines for better readability
  return texts.join(' ')
}

async function extractFromPptx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)/)?.[1] ?? '0')
      const nb = parseInt(b.match(/(\d+)/)?.[1] ?? '0')
      return na - nb
    })

  const parts: string[] = []
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string')
    const text = extractTextFromPptx(xml)
    if (text.trim()) parts.push(`[الشريحة ${i + 1}]: ${text}`)
  }
  return parts.join('\n')
}

async function extractFromDocx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.files['word/document.xml']
  if (!docFile) throw new Error('word/document.xml not found in DOCX')
  const xml = await docFile.async('string')
  return extractTextFromDocx(xml)
}

async function extractFromPdf(buffer: ArrayBuffer): Promise<string> {
  // pdf-parse v2: class-based API (no default export function)
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: Buffer.from(buffer) })
  const result = await parser.getText()
  return result.text
}

async function extractText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const ext = file.name.toLowerCase().split('.').pop()

  switch (ext) {
    case 'pptx': return extractFromPptx(buffer)
    case 'docx': return extractFromDocx(buffer)
    case 'pdf':  return extractFromPdf(buffer)
    default: throw new Error(`Unsupported file type: .${ext}`)
  }
}

// ── AI response parser ───────────────────────────────────────────

interface GeneratedLesson { title: string; order: number }
interface GeneratedUnit   { name: string; order: number; lessons: GeneratedLesson[] }
interface GeneratedCourse {
  title: string
  description: string
  language: string
  has_levels: boolean
  units: GeneratedUnit[]
}

function parseAiJsonResponse(text: string): GeneratedCourse {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in AI response')
  return JSON.parse(match[0]) as GeneratedCourse
}

// ── Route handler ────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, can_create_courses').eq('id', user.id).single()
  if (!profile?.can_create_courses) {
    return NextResponse.json({ error: 'Forbidden: course creation not enabled for your account' }, { status: 403 })
  }

  const rl = await rateLimit(`course-file:${user.id}`, { limit: 5, windowSecs: 3600 })
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
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const ext = file.name.toLowerCase().split('.').pop()
  if (!['pptx', 'docx', 'pdf'].includes(ext ?? '')) {
    return NextResponse.json({ error: 'Unsupported file type. Please upload a .pptx, .docx, or .pdf file.' }, { status: 400 })
  }

  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 400 })
  }

  let slideText: string
  try {
    slideText = await extractText(file)
  } catch (e) {
    console.error('[generate-course-file] extraction error:', e)
    return NextResponse.json({ error: 'Failed to read the file. Make sure it is a valid and non-corrupted file.' }, { status: 422 })
  }

  if (!slideText.trim()) {
    return NextResponse.json({ error: 'No text could be extracted from this file. It may be image-only or empty.' }, { status: 422 })
  }

  const truncatedText = slideText.slice(0, 6000)

  const prompt = `You are an AI assistant for a university learning management system.

A teacher uploaded a document file. The extracted text is below.

Your task: analyze the content and generate a structured course in JSON format.

RULES:
- Detect the language of the content and use that language for all output
- Infer the course title and description from the content
- Create units based on the main topics/sections in the document
- For each unit, suggest 2-3 lesson titles that cover that topic
- has_levels should be true only if the content explicitly has level progression (e.g. Beginner/Intermediate/Advanced)
- Return ONLY valid JSON, no markdown, no explanation

JSON Schema:
{
  "title": "string - the course title",
  "description": "string - 2-3 sentence course description",
  "language": "string - main language of the content",
  "has_levels": false,
  "units": [
    {
      "name": "string - unit name",
      "order": 1,
      "lessons": [
        { "title": "string - lesson title", "order": 1 },
        { "title": "string - lesson title", "order": 2 }
      ]
    }
  ]
}

Document content:
${truncatedText}`

  try {
    const aiResponse = await groqChat(prompt, 'Return only valid JSON. No markdown. No explanation.')
    const course = parseAiJsonResponse(aiResponse)

    if (!course.title || !Array.isArray(course.units) || course.units.length === 0) {
      throw new Error('AI returned incomplete course structure')
    }

    // Return the extracted text too so it can be stored on the course and used
    // to generate each section's content strictly from this file (no outside knowledge).
    return NextResponse.json({ course, charCount: slideText.length, sourceText: slideText.slice(0, 12000) })
  } catch (e) {
    console.error('[generate-course-file] AI error:', e)
    return NextResponse.json({ error: 'Failed to generate course structure from file.' }, { status: 500 })
  }
}
