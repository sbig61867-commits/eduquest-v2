import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { aiChat } from '@/lib/ai/chat'
import { extractTextFromFile, extractionErrorResponse } from '@/lib/ai/extract'

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

  let slideText: string
  try {
    // Unified extractor — now with Gemini vision fallback, so scanned PDFs
    // work here too (previously this route had no vision path).
    slideText = await extractTextFromFile(file)
  } catch (e) {
    console.error('[generate-course-file] extraction error:', e)
    const { status, error } = extractionErrorResponse(e)
    return NextResponse.json({ error }, { status })
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
    const aiResponse = await aiChat(prompt, 'Return only valid JSON. No markdown. No explanation.')
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
