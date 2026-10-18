import { getLocale } from 'next-intl/server'
import { NextResponse } from 'next/server'
import { aiPrompts } from '@/content/ai'
import type { ImproveAction } from '@/content/ai/types'
import { toLocale } from '@/i18n/config'
import { apiErr } from '@/lib/api-error'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { aiChat } from '@/lib/ai/chat'
import { authorizeAiUsage, meteredAiRoute } from '@/lib/ai/usage'
import { logAiFailure } from '@/lib/ai/meter'
import { audienceApproved, PrivacyPendingError, type AiAudience } from '@/lib/ai/privacy'
import { richTextFits } from '@/lib/lesson-rich-text'

// "Improve this block" in the lesson editor (owner, 2026-10-18): one block of a
// lesson, one action (simpler / fuller / add an example / fix language /
// shorter). The text is the teacher's lesson content, so it is institutional.
// Nothing is stored: the editor shows the suggestion and the teacher decides.

const AUDIENCES: AiAudience[] = ['institution']
const ACTIONS: ImproveAction[] = ['simplify', 'expand', 'example', 'fix', 'shorter']
const MAX_BLOCK_CHARS = 4000
const EDITORS = ['teacher', 'super_admin']

/** Keeps only what the lesson renderer shows; drops any HTML-looking tag. */
function cleanSuggestion(raw: string): string {
  let text = raw.trim().replace(/^```[a-z]*\n?|\n?```$/gi, '').trim()
  text = text.replace(/<\/?[a-z][^>]*>/gi, '')
  return text.slice(0, MAX_BLOCK_CHARS)
}

export const POST = meteredAiRoute('improve_block', async (request: Request) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !EDITORS.includes(profile.role)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  // Privacy first: refuse before the allowance check, the body read or any call (privacy.ts).
  if (!audienceApproved(AUDIENCES)) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })

  const denied = await authorizeAiUsage(user.id)
  if (denied) return denied

  const limit = await rateLimit(`improve_block:${user.id}`, { limit: 30, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('rateLimited')) }, { status: 429 })

  let body: { text?: unknown; action?: unknown; lessonTitle?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const action = ACTIONS.includes(body.action as ImproveAction) ? body.action as ImproveAction : null
  const lessonTitle = typeof body.lessonTitle === 'string' ? body.lessonTitle.trim().slice(0, 200) : ''
  if (!text || !action) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  if (text.length > MAX_BLOCK_CHARS) return NextResponse.json({ ...(await apiErr('textTooLong')) }, { status: 400 })

  const prompts = aiPrompts(toLocale(await getLocale())).improveBlock
  try {
    const raw = await aiChat(prompts.request(action, text, lessonTitle), prompts.system, { temperature: 0.4, audiences: AUDIENCES })
    const suggestion = cleanSuggestion(raw)
    if (!suggestion || !richTextFits(suggestion)) {
      return NextResponse.json({ ...(await apiErr('aiNoValidSuggestions')) }, { status: 502 })
    }
    return NextResponse.json({ suggestion })
  } catch (err) {
    if (err instanceof PrivacyPendingError) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })
    logAiFailure('[api/ai/improve-block]', err)
    return NextResponse.json({ ...(await apiErr('aiUnavailable')) }, { status: 503 })
  }
})
