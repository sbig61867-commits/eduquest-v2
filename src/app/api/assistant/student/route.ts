import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { aiRateLimit } from '@/lib/rate-limit'
import { authorizeAiUsage, meteredAiRoute } from '@/lib/ai/usage'
import { aiChat } from '@/lib/ai/chat'
import { audienceApproved, PrivacyPendingError, type AiAudience } from '@/lib/ai/privacy'
import { aiErrorCode } from '@/lib/ai/meter'
import { redactSensitive } from '@/lib/ai/redact'
import { buildAssistantContext } from '@/lib/assistant/context-bundle'
import {
  loadLessonIndex,
  matchLessonTitle,
  wantsAccountOverview,
} from '@/lib/assistant/student-context'
import {
  buildAssistantPrompt,
  clipAnswer,
  lessonDocToModelText,
  MAX_LESSON_CHARS,
  parseAssistantBody,
} from '@/lib/assistant/student-prompt'

// One provider call per message, bounded by the provider timeout (AI_TIMEOUT_MS).
export const maxDuration = 60

// Provisional per-student cap. Tune from measured usage before any release.
const MESSAGES_PER_HOUR = 30

// The student's own question is `personal`: it can name a person, a grade, or
// an unpublished concern. Since 2026-10-18 (owner) it goes to the provider
// approved for personal content, after redactSensitive() has taken out names,
// contact details, identifiers and links (privacy.ts, redact.ts).
const MESSAGE_AUDIENCE: AiAudience = 'personal'

type Unavailable = 'lesson' | 'account'

/** Notices for context that was withheld because no provider is approved for it. */
async function noticesFor(unavailable: Set<Unavailable>) {
  const out: { code: string; error: string }[] = []
  if (unavailable.has('lesson')) out.push(await apiErr('assistantLessonUnavailable'))
  if (unavailable.has('account')) out.push(await apiErr('assistantAccountUnavailable'))
  return out
}

export const POST = meteredAiRoute('student-assistant', async (request: Request) => {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (user.role !== 'student') return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  // Privacy first: refuse before the allowance check, the body read or any call (privacy.ts).
  if (!audienceApproved([MESSAGE_AUDIENCE])) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })

  // Monthly institution allowance first, then the per-student window.
  const denied = await authorizeAiUsage(user.id)
  if (denied) return denied

  const rl = await aiRateLimit(`assistant:${user.id}`, { limit: MESSAGES_PER_HOUR, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  const parsed = parseAssistantBody(raw)
  if (!parsed.ok) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  // Only the question leaves: the student's name, contact details, identifiers
  // and links are taken out of everything the student wrote (redact.ts).
  const { data: me } = await supabase.from('users').select('full_name').eq('id', user.id).maybeSingle()
  const names = [(me as { full_name?: string | null } | null)?.full_name]
  const input = {
    ...parsed.value,
    message: redactSensitive(parsed.value.message, names),
    selection: parsed.value.selection === null ? null : redactSensitive(parsed.value.selection, names),
    history: parsed.value.history.map(h => ({ ...h, content: redactSensitive(h.content, names) })),
  }

  // Which kinds of context may leave the server at all. A provider is approved
  // per audience in chat.ts; with none approved for an audience, that content
  // is withheld and the answer says so. Access checks below still run.
  const institutionOk = audienceApproved(['institution'])
  const personalOk = audienceApproved(['personal'])
  const unavailable = new Set<Unavailable>()

  // The lesson is read through the student's own session: RLS returns it only
  // when published and in one of the student's active groups. A missing row and
  // a forbidden row get the same answer, so the route does not reveal which exists.
  // With no lesson picked, a lesson named in the message is used.
  let lessonId: string | null = input.lessonId
  if (!lessonId) lessonId = matchLessonTitle(input.message, await loadLessonIndex(supabase))

  let lessonModelText: string | null = null
  if (lessonId) {
    const { data: lesson } = await supabase
      .from('lessons')
      .select('id, content')
      .eq('id', lessonId)
      .maybeSingle()
    if (!lesson) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    lessonModelText = lessonDocToModelText(lesson.content)
  }

  // Account data (grades, groups, announcements) never goes to a provider (owner,
  // 2026-10-18): a question about it gets the "not available" notice instead.
  const account: string | null = null
  if (wantsAccountOverview(input.message)) unavailable.add('account')

  // The policy sees the whole lesson and the selection before anything is cut.
  // It runs even when the text will be withheld, so a refused source still fails closed.
  const sources = []
  if (lessonModelText !== null) sources.push({ kind: 'lesson' as const, content: lessonModelText })
  if (input.selection) sources.push({ kind: 'lesson' as const, content: input.selection })
  const ctx = buildAssistantContext(sources)
  if (!ctx.ok) return NextResponse.json({ ...(await apiErr('assistantContentRefused')) }, { status: 422 })

  const lessonItem = ctx.items[0]
  const selectionItem = lessonId ? ctx.items[1] : ctx.items[0]
  const lessonCandidate = lessonItem && lessonId && lessonItem.kind === 'lesson' ? lessonItem.text : null
  const selectionCandidate = selectionItem && selectionItem.kind === 'lesson' && input.selection ? selectionItem.text : null

  if (!institutionOk && (lessonCandidate !== null || selectionCandidate !== null)) unavailable.add('lesson')
  const lessonForPrompt = institutionOk ? lessonCandidate : null
  const selectionForPrompt = institutionOk ? selectionCandidate : null
  const truncated = lessonForPrompt !== null && lessonForPrompt.length > MAX_LESSON_CHARS
  const lessonText = lessonForPrompt === null ? null : lessonForPrompt.slice(0, MAX_LESSON_CHARS)

  // Earlier turns may repeat account or lesson text, so they travel only when
  // a personal-approved provider exists.
  const history = personalOk ? input.history : []

  // The audiences of what is actually in the prompt. The provider must be approved for all of them.
  const audiences = new Set<AiAudience>([MESSAGE_AUDIENCE])
  if (lessonText !== null || selectionForPrompt !== null) audiences.add('institution')
  if (account !== null || history.length > 0) audiences.add('personal')

  const { system, prompt } = buildAssistantPrompt({
    mode: input.mode,
    message: input.message,
    lessonText,
    selection: selectionForPrompt,
    account,
    history,
    boundary: crypto.randomUUID().replace(/-/g, ''),
  })

  try {
    const reply = await aiChat(prompt, system, { temperature: 0.3, audiences: [...audiences] })
    return NextResponse.json({
      answer: clipAnswer(reply),
      truncated,
      notices: await noticesFor(unavailable),
    })
  } catch (e) {
    if (e instanceof PrivacyPendingError) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })
    if (e instanceof Error && e.message.includes('No AI provider configured')) {
      return NextResponse.json({ ...(await apiErr('noAiProvider')) }, { status: 503 })
    }
    // Status code only: provider messages can echo parts of the prompt.
    console.error('[student-assistant] provider failed:', aiErrorCode(e))
    return NextResponse.json({ ...(await apiErr('aiGenerationFailed')) }, { status: 500 })
  }
})
