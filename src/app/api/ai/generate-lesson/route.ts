import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateLessonContent } from '@/lib/ai/gemini'
import { generateLessonContentGroq } from '@/lib/ai/groq'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 10 AI lesson requests per user per hour
  const rl = await rateLimit(`lesson:${user.id}`, { limit: 10, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: { topic?: string; level?: string; customInstructions?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawTopic = body.topic?.trim() ?? ''
  const level = body.level?.trim() ?? 'undergraduate'
  const rawInstructions = body.customInstructions?.trim() ?? ''

  if (!rawTopic) return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
  if (rawTopic.length > 200) return NextResponse.json({ error: 'Topic is too long (max 200 chars)' }, { status: 400 })
  if (rawInstructions.length > 1000) return NextResponse.json({ error: 'Instructions too long (max 1000 chars)' }, { status: 400 })

  // Sanitize both fields against prompt injection
  const topic = rawTopic.replace(/[<>{}[\]`\\]/g, '').trim()
  const customInstructions = rawInstructions.replace(/[<>{}[\]`\\]/g, '').trim() || undefined

  const groqKey = process.env.GROQ_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  const hasGroq = groqKey && groqKey !== 'your_groq_api_key_here'
  const hasGemini = geminiKey && geminiKey !== 'your_gemini_api_key_here'

  if (!hasGroq && !hasGemini) {
    return NextResponse.json({ error: 'No AI provider configured' }, { status: 503 })
  }

  try {
    if (hasGroq) {
      const content = await generateLessonContentGroq(topic, level, customInstructions)
      return NextResponse.json({ content, provider: 'groq' })
    }
    const content = await generateLessonContent(topic, level, customInstructions)
    return NextResponse.json({ content, provider: 'gemini' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[generate-lesson]', msg)
    if (hasGroq && hasGemini) {
      try {
        const content = await generateLessonContent(topic, level, customInstructions)
        return NextResponse.json({ content, provider: 'gemini-fallback' })
      } catch {}
    }
    return NextResponse.json({ error: 'AI generation failed', detail: msg }, { status: 500 })
  }
}
