import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateLessonContentAI } from '@/lib/ai/chat'
import { aiRateLimit } from '@/lib/rate-limit'
import { getAiRateLimits } from '@/lib/settings'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const aiLimits = await getAiRateLimits(supabase)
  const rl = await aiRateLimit(`lesson:${user.id}`, { limit: aiLimits.lesson_per_hour, windowSecs: 3600 })
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

  // Sanitize both fields against prompt injection (same ruleset as generate-exam)
  const topic = rawTopic.replace(/[<>{}[\]`\\'"]/g, '').trim()
  if (!topic) return NextResponse.json({ error: 'Topic contains invalid characters' }, { status: 400 })
  const customInstructions = rawInstructions.replace(/[<>{}[\]`\\'"]/g, '').trim() || undefined

  // aiChat tries Groq → Cerebras → Gemini → OpenRouter, skipping providers
  // whose keys are not configured.
  try {
    const { content, provider } = await generateLessonContentAI(topic, level, customInstructions)
    return NextResponse.json({ content, provider })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[generate-lesson]', msg)
    if (msg.includes('No AI provider configured')) {
      return NextResponse.json({ error: 'No AI provider configured' }, { status: 503 })
    }
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}
