import { aiCaller } from '@/lib/ai/caller'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { generateLessonContentAI } from '@/lib/ai/chat'
import { authorizeAiUsage, meteredAiRoute } from '@/lib/ai/usage'
import { aiRateLimit } from '@/lib/rate-limit'
import { logAiFailure } from '@/lib/ai/meter'
import { audienceApproved, PrivacyPendingError } from '@/lib/ai/privacy'
import { normalizeLessonLevel } from '@/lib/ai/public-input'
import { normalizeTransliterations } from '@/lib/ai/arabic-transliteration'

export const POST = meteredAiRoute('lesson', async (request: Request) => {
  const caller = await aiCaller()
  if (!caller) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: caller.ctx.sub }

  const profile = { role: caller.role, tenant_id: caller.tenantId, permissions: caller.permissions, can_create_courses: caller.canCreateCourses }
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // The topic alone travels as public content (public-input.ts).
  if (!audienceApproved(['public'])) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })

  // Monthly AI allowance of the institution (super_admin sets it per tenant).
  const denied = await authorizeAiUsage(user.id)
  if (denied) return denied

  const aiLimits = caller.limits
  const rl = await aiRateLimit(`lesson:${user.id}`, { limit: aiLimits.lesson_per_hour, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: { topic?: string; level?: string; customInstructions?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }

  if ((body.topic !== undefined && typeof body.topic !== 'string')
    || (body.customInstructions !== undefined && typeof body.customInstructions !== 'string')) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  const rawTopic = body.topic?.trim() ?? ''
  const level = normalizeLessonLevel(body.level)
  if (!level) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  const rawInstructions = body.customInstructions?.trim() ?? ''

  if (!rawTopic) return NextResponse.json({ ...(await apiErr('subjectRequired')) }, { status: 400 })
  if (rawTopic.length > 200) return NextResponse.json({ ...(await apiErr('topicTooLong')) }, { status: 400 })
  if (rawInstructions.length > 1000) return NextResponse.json({ ...(await apiErr('instructionsTooLong')) }, { status: 400 })

  // Sanitize both fields against prompt injection (same ruleset as generate-exam)
  const topic = rawTopic.replace(/[<>{}[\]`\\'"]/g, '').trim()
  if (!topic) return NextResponse.json({ ...(await apiErr('topicInvalidChars')) }, { status: 400 })
  const customInstructions = rawInstructions.replace(/[<>{}[\]`\\'"]/g, '').trim() || undefined

  // Free-text instructions are institutional content. They are refused, never
  // dropped silently, while no provider is approved for them.
  if (customInstructions && !audienceApproved(['institution'])) {
    return NextResponse.json({ ...(await apiErr('aiCustomInstructionsUnavailable')) }, { status: 422 })
  }

  // aiChat tries Groq → xKiro → Cohere → Gemini → OpenRouter, skipping
  // providers whose keys are not configured.
  try {
    const { content, provider } = await generateLessonContentAI(topic, level, customInstructions)
    return NextResponse.json({ content: normalizeTransliterations(content), provider })
  } catch (e: unknown) {
    if (e instanceof PrivacyPendingError) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })
    const msg = e instanceof Error ? e.message : String(e)
    logAiFailure('[generate-lesson]', e)
    if (msg.includes('No AI provider configured')) {
      return NextResponse.json({ ...(await apiErr('noAiProvider')) }, { status: 503 })
    }
    return NextResponse.json({ ...(await apiErr('aiGenerationFailed')) }, { status: 500 })
  }
})
