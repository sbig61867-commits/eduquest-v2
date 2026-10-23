import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { aiRateLimit } from '@/lib/rate-limit'
import { aiChat } from '@/lib/ai/chat'
import { authorizeAiUsage, meteredAiRoute } from '@/lib/ai/usage'
import { logAiFailure } from '@/lib/ai/meter'
import { audienceApproved, type AiAudience } from '@/lib/ai/privacy'
import { normalizeTransliterations } from '@/lib/ai/arabic-transliteration'

// Course source text is institutional content.
const AUDIENCES: AiAudience[] = ['institution']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/courses/generate-item-content  body: { course_id, title }
// Generates the markdown content for one section STRICTLY from the course's stored
// source file text — never from outside/general knowledge.
export const POST = meteredAiRoute('item-content', async (request: Request) => {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const tenantId = ctx.tenant_id

  // Privacy first: refuse before the allowance check, the body read or any call (privacy.ts).
  if (!audienceApproved(AUDIENCES)) return NextResponse.json({ ...(await apiErr('aiPrivacyPending')) }, { status: 503 })

  // Monthly AI allowance of the institution (super_admin sets it per tenant).
  const denied = await authorizeAiUsage(user.id)
  if (denied) return denied

  const rl = await aiRateLimit(`item-content:${user.id}`, { limit: 30, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { ...(await apiErr('rateLimited')) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let body: { course_id?: string; title?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const { course_id, title } = body
  if (!course_id || !title?.trim()) {
    return NextResponse.json({ ...(await apiErr('courseIdAndTitleRequired')) }, { status: 400 })
  }

  // Verify the teacher owns the course and pull its stored source text (only
  // a course of the caller's institution is visible in this scope).
  if (!UUID.test(course_id)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  const [courseRows] = await run({ as: 'service', tenantId }, sql => [
    sql`select teacher_id, source_text, language from public.courses where id = ${course_id} and tenant_id = ${tenantId}`,
  ])
  const course = maybeOne<{ teacher_id: string; source_text: string | null; language: string | null }>(courseRows)
  if (!course || course.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  if (!course.source_text?.trim()) {
    return NextResponse.json(
      { ...(await apiErr('courseNoSourceFile')) },
      { status: 422 }
    )
  }

  const prompt = `You are writing lesson content for a course section.
Use ONLY the source material below. Do NOT add facts, examples, or information that are not present in the source. Do NOT use outside or general knowledge. Keep the same language as the source.
If the source does not cover the section, say so briefly instead of inventing content.

Section to write: "${title.trim()}"

Format the output in clean Markdown.

=== SOURCE MATERIAL (the only allowed source) ===
${course.source_text.slice(0, 10000)}`

  try {
    const content = await aiChat(
      prompt,
      'Write lesson content in Markdown strictly from the provided source material. Never add outside knowledge.',
      { audiences: AUDIENCES },
    )
    return NextResponse.json({ content: normalizeTransliterations(content) })
  } catch (e) {
    logAiFailure('[generate-item-content]', e)
    return NextResponse.json({ ...(await apiErr('aiGenerationFailed')) }, { status: 500 })
  }
})
