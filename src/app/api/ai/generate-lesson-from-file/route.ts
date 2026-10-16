import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { aiRateLimit } from '@/lib/rate-limit'
import { authorizeAiUsage, meteredAiRoute } from '@/lib/ai/usage'
import { logAiFailure } from '@/lib/ai/meter'
import { audienceApproved, PrivacyPendingError, type AiAudience } from '@/lib/ai/privacy'
import { COMPOSE_BUDGET_MS, composeLesson } from '@/lib/ai/lesson-compose'
import { ExtractionError, extractTextFromFile, extractionErrorResponse, readFormDataCapped } from '@/lib/ai/extract'
import { getAiRateLimits } from '@/lib/settings'

// A full lesson from a long file is several minutes of generation, not one.
// Composition runs inside COMPOSE_BUDGET_MS (lesson-compose.ts), below this.
export const maxDuration = 300

// The uploaded file and the teacher's instructions are institutional content.
const AUDIENCES: AiAudience[] = ['institution']

// ── Route ────────────────────────────────────────────────────────

export const POST = meteredAiRoute('lesson-from-file', async (request: Request) => {
  const started = Date.now()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Privacy first: refuse before the allowance check, the body read or any call (privacy.ts).
  if (!audienceApproved(AUDIENCES)) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })

  // Monthly AI allowance of the institution (super_admin sets it per tenant).
  const denied = await authorizeAiUsage(user.id)
  if (denied) return denied

  // Limit comes from super-admin settings (ai_rate_limits.lesson_per_hour),
  // same as topic-based lesson generation — no more hardcoded 10.
  const aiLimits = await getAiRateLimits(supabase)
  const rl = await aiRateLimit(`lesson-file:${user.id}`, { limit: aiLimits.lesson_per_hour, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let formData: FormData
  // Reads at most UPLOAD_MAX_REQUEST_BYTES of body, whatever Content-Length says.
  try { formData = await readFormDataCapped(request) }
  catch (e) {
    if (e instanceof ExtractionError && e.code === 'too_large') return NextResponse.json({ ...(await apiErr('fileTooLarge')) }, { status: 413 })
    return NextResponse.json({ ...(await apiErr('invalidFormData')) }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const customInstructions = (formData.get('instructions') as string | null)?.slice(0, 1000) ?? ''
  const level = (formData.get('level') as string | null) ?? 'undergraduate'

  // Teacher-selected question types for the quiz/test tabs (toggle chips in
  // the UI). Sanitized to the known set; empty/absent → auto-gradable pair.
  const ALLOWED_QTYPES = ['true_false', 'mcq', 'essay'] as const
  let questionTypes: string[] = []
  try { questionTypes = JSON.parse((formData.get('question_types') as string | null) ?? '[]') } catch { /* default below */ }
  questionTypes = questionTypes.filter(t => (ALLOWED_QTYPES as readonly string[]).includes(t))
  if (questionTypes.length === 0) questionTypes = ['true_false', 'mcq']

  if (!file) return NextResponse.json({ ...(await apiErr('noFileUploaded')) }, { status: 400 })

  let fullText: string
  try {
    // No truncation — the teacher asked for the full source content, not a
    // summary, so cutting it at a fixed length would silently drop material.
    fullText = await extractTextFromFile(file)
  } catch (e) {
    logAiFailure('[generate-lesson-from-file] extraction:', e)
    const { status, error, code } = await extractionErrorResponse(e)
    return NextResponse.json({ error, code }, { status })
  }

  try {
    const { content } = await composeLesson({
      fullText, level, customInstructions, qTypes: questionTypes,
      audiences: AUDIENCES, deadline: started + COMPOSE_BUDGET_MS,
    })
    return NextResponse.json({ content })
  } catch (e) {
    if (e instanceof PrivacyPendingError) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })
    logAiFailure('[generate-lesson-from-file] AI:', e)
    return NextResponse.json({ ...(await apiErr('aiGenerationFailed')) }, { status: 500 })
  }
})

// Prompt text: src/content/ai/lesson-from-file.ts. Composition: src/lib/ai/lesson-compose.ts.
