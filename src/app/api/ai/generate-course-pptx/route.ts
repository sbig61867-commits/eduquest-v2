import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import JSZip from 'jszip'
import { groqChat } from '@/lib/ai/groq'

// Extract text from PPTX slide XML
function extractTextFromSlideXml(xml: string): string {
  const texts: string[] = []
  // Match <a:t>...</a:t> tags (DrawingML text runs)
  const matches = xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)
  for (const m of matches) {
    const t = m[1].trim()
    if (t) texts.push(t)
  }
  return texts.join(' ')
}

async function extractPptxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)/)?.[1] ?? '0')
      const nb = parseInt(b.match(/(\d+)/)?.[1] ?? '0')
      return na - nb
    })

  const slideTexts: string[] = []
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string')
    const text = extractTextFromSlideXml(xml)
    if (text.trim()) {
      slideTexts.push(`[الشريحة ${i + 1}]: ${text}`)
    }
  }
  return slideTexts.join('\n')
}

interface GeneratedUnit {
  name: string
  order: number
  lessons: { title: string; order: number }[]
}

interface GeneratedCourse {
  title: string
  description: string
  language: string
  has_levels: boolean
  units: GeneratedUnit[]
}

function parseAiJsonResponse(text: string): GeneratedCourse {
  // Strip markdown code fences
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in AI response')
  return JSON.parse(match[0]) as GeneratedCourse
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, can_create_courses').eq('id', user.id).single()
  if (!profile?.can_create_courses) {
    return NextResponse.json({ error: 'Forbidden: course creation not enabled for your account' }, { status: 403 })
  }

  // 3 PPTX generations per user per hour (expensive operation)
  const rl = await rateLimit(`course-pptx:${user.id}`, { limit: 3, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  if (!file.name.toLowerCase().endsWith('.pptx')) {
    return NextResponse.json({ error: 'Only .pptx files are supported' }, { status: 400 })
  }

  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 400 })
  }

  // Extract text from PPTX
  let slideText: string
  try {
    const buffer = await file.arrayBuffer()
    slideText = await extractPptxText(buffer)
  } catch (e) {
    console.error('[generate-course-pptx] extraction error:', e)
    return NextResponse.json({ error: 'Failed to read PPTX file. Make sure it is a valid .pptx file.' }, { status: 422 })
  }

  if (!slideText.trim()) {
    return NextResponse.json({ error: 'Could not extract any text from the file. The file may be empty or image-only.' }, { status: 422 })
  }

  // Limit slide text to avoid token overflow
  const truncatedText = slideText.slice(0, 6000)

  const prompt = `You are an AI assistant for a university learning management system.

A teacher uploaded a PowerPoint presentation. The extracted slide text is below.

Your task: analyze the content and generate a structured course in JSON format.

RULES:
- Detect the language of the content and use that language for all output
- Infer the course title and description from the content
- Create units based on the main topics/sections in the slides
- For each unit, suggest 2-3 lesson titles that cover that topic
- has_levels should be true only if the content is language learning or has explicit level progression
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

Slide content:
${truncatedText}`

  try {
    const aiResponse = await groqChat(prompt, 'Return only valid JSON. No markdown. No explanation.')
    const course = parseAiJsonResponse(aiResponse)

    // Validate structure
    if (!course.title || !Array.isArray(course.units) || course.units.length === 0) {
      throw new Error('AI returned incomplete course structure')
    }

    return NextResponse.json({ course, slideCharCount: slideText.length })
  } catch (e) {
    console.error('[generate-course-pptx] AI error:', e)
    return NextResponse.json({ error: 'Failed to generate course structure from file.' }, { status: 500 })
  }
}
