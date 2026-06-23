import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

interface Question {
  id: string
  text: string
  type: 'mcq' | 'true_false'
  options: string[]
  correct_answer: string
  points: number
}

function validateQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) throw new Error('Response is not an array')
  return raw.map((q, i) => {
    if (typeof q !== 'object' || q === null) throw new Error(`Item ${i} is not an object`)
    const item = q as Record<string, unknown>
    if (typeof item.text !== 'string' || !item.text) throw new Error(`Item ${i} missing text`)
    if (!['mcq', 'true_false'].includes(item.type as string)) throw new Error(`Item ${i} has invalid type`)
    if (!Array.isArray(item.options) || item.options.length < 2) throw new Error(`Item ${i} has invalid options`)
    if (typeof item.correct_answer !== 'string') throw new Error(`Item ${i} missing correct_answer`)
    if (typeof item.points !== 'number') throw new Error(`Item ${i} missing points`)
    return {
      id: String(item.id ?? i + 1),
      text: item.text as string,
      type: item.type as 'mcq' | 'true_false',
      options: item.options as string[],
      correct_answer: item.correct_answer as string,
      points: item.points as number,
    }
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 20 exam generations per user per hour
  const rl = await rateLimit(`exam:${user.id}`, { limit: 20, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type = 'mixed' } = body
  const rawTopic: string = (body.topic as string) ?? ''
  const count: number = Math.min(Math.max(parseInt(String(body.count ?? '10'), 10) || 10, 1), 30)

  if (!rawTopic.trim()) return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
  if (rawTopic.length > 200) return NextResponse.json({ error: 'Topic is too long (max 200 chars)' }, { status: 400 })

  // Strip prompt-injection characters — keep only printable non-special chars
  const safeTopic = rawTopic.trim().replace(/[<>{}[\]`\\'"]/g, '').trim()
  if (!safeTopic) return NextResponse.json({ error: 'Topic contains invalid characters' }, { status: 400 })

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey || groqKey === 'your_groq_api_key_here') {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 })
  }

  const typeInstructions = type === 'mcq'
    ? 'multiple choice questions with 4 options each'
    : type === 'true_false'
    ? 'true/false questions'
    : 'a mix: 60% multiple choice (4 options) and 40% true/false'

  const prompt = `Generate exactly ${count} ${typeInstructions} about the topic: ${safeTopic}. For university students.
Return ONLY a valid JSON array, no markdown:
[
  {"id":"1","text":"Question?","type":"mcq","options":["A","B","C","D"],"correct_answer":"A","points":10},
  {"id":"2","text":"True or false?","type":"true_false","options":["True","False"],"correct_answer":"True","points":5}
]
Rules: MCQ has exactly 4 options and 10 points. true_false has ["True","False"] and 5 points. correct_answer must match an option exactly.`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Return only valid JSON arrays, no markdown, no explanations.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 4096,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Groq API error ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty response from Groq')

    const text = content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '')
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array found in response')

    const raw = JSON.parse(jsonMatch[0])
    const questions = validateQuestions(raw)

    return NextResponse.json({ questions })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[generate-exam]', msg)
    return NextResponse.json({ error: 'Failed to generate questions', detail: msg }, { status: 500 })
  }
}
