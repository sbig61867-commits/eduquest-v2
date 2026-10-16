import { getLocale } from 'next-intl/server'
import { aiPrompts } from '@/content/ai'
import { toLocale } from '@/i18n/config'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { groqChat } from '@/lib/ai/groq'
import { authorizeAiUsage, meteredAiRoute } from '@/lib/ai/usage'
import { parseTaskSuggestion } from '@/lib/individual-task'
import { logAiFailure } from '@/lib/ai/meter'
import { audienceApproved, type AiAudience } from '@/lib/ai/privacy'

// A student's written answer is personal data; the question and the teacher's notes are institutional.
const AUDIENCES: AiAudience[] = ['personal', 'institution']

// POST /api/ai/individual-task — drafts ONE student's weak points and a short
// rework task from their written answer (typed on the platform, or read from a
// photo of their paper by /api/ai/extract-file). On demand only: nothing calls
// it on page load, it is rate-limited and logged, and it only returns a draft —
// the teacher edits it and sends it through /api/exams/individual.
//
// Free: groqChat (AI must stay free). The answer text is sent to the model as
// data inside quotes; the model is told to judge only what is in it.

const MAX_ANSWER = 12000

export const POST = meteredAiRoute('individual_task', async (request: Request) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id || !['teacher', 'university_admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  // Privacy first: refuse before the allowance check, the body read or any call (privacy.ts).
  if (!audienceApproved(AUDIENCES)) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })

  // Monthly AI allowance of the institution (super_admin sets it per tenant).
  const denied = await authorizeAiUsage(user.id)
  if (denied) return denied

  const limit = await rateLimit(`individual_task_ai:${user.id}`, { limit: 30, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  let body: { answer?: unknown; question?: unknown; exam_title?: unknown; notes?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const answer = text(body.answer, MAX_ANSWER + 1)
  if (!answer) return NextResponse.json({ ...(await apiErr('noSourceText')) }, { status: 400 })
  if (answer.length > MAX_ANSWER) return NextResponse.json({ ...(await apiErr('textTooLong')) }, { status: 400 })

  const locale = toLocale(await getLocale())
  const prompts = aiPrompts(locale).individualTask
  const prompt = prompts.request({
    examTitle: text(body.exam_title, 200),
    question: text(body.question, 4000),
    answer,
    notes: text(body.notes, 2000),
  })

  try {
    const raw = await groqChat(prompt, prompts.system, 0.4, AUDIENCES)
    const suggestion = parseTaskSuggestion(raw)
    if (!suggestion) return NextResponse.json({ ...(await apiErr('aiNoValidSuggestions')) }, { status: 502 })
    return NextResponse.json(suggestion)
  } catch (err) {
    logAiFailure('[api/ai/individual-task]', err)
    return NextResponse.json({ ...(await apiErr('aiUnavailable')) }, { status: 503 })
  }
})
