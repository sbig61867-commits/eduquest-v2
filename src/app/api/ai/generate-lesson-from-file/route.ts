import { apiErr } from '@/lib/api-error'
import { buildLessonFromFilePrompt } from '@/content/ai/lesson-from-file'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { aiRateLimit } from '@/lib/rate-limit'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { aiChatDetailed } from '@/lib/ai/chat'
import { logAiUsage } from '@/lib/ai/usage'
import { AI_TIMEOUT_MS } from '@/lib/ai/timeout'
import { extractTextFromFile, extractionErrorResponse } from '@/lib/ai/extract'
import { getAiRateLimits } from '@/lib/settings'

export const maxDuration = 60

// gemini-2.0-flash was retired by Google (404) — gemini-2.5-flash is the
// current stable free-tier model, verified live. It caps a single response
// around 8192 output tokens (~24k chars). Groq's gpt-oss-120b caps at 4096 —
// Gemini gives a materially larger single-pass ceiling, which is why
// composition (not just vision extraction) now runs through it.
const GEMINI_MODEL = 'gemini-2.5-flash'
const MAX_OUTPUT_TOKENS = 8192

function getGeminiModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  return new GoogleGenerativeAI(key).getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  }, { timeout: AI_TIMEOUT_MS })
}

// ── Route ────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

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
  try { formData = await request.formData() }
  catch { return NextResponse.json({ ...(await apiErr('invalidFormData')) }, { status: 400 }) }

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
    console.error('[generate-lesson-from-file] extraction:', e)
    const { status, error, code } = await extractionErrorResponse(e)
    return NextResponse.json({ error, code }, { status })
  }

  try {
    const { content, provider } = await composeLesson(fullText, level, customInstructions, questionTypes)
    void logAiUsage(user.id, profile.tenant_id, 'lesson-from-file', provider)
    return NextResponse.json({ content })
  } catch (e) {
    console.error('[generate-lesson-from-file] AI:', e)
    return NextResponse.json({ ...(await apiErr('aiGenerationFailed')) }, { status: 500 })
  }
}

// Prompt text: src/content/ai/lesson-from-file.ts.

// Splits on paragraph boundaries (never mid-sentence) once a chunk would
// approach Gemini's output ceiling, so long documents (~20+ pages) still
// come back complete instead of being cut off silently.
const CHUNK_CHAR_TARGET = 14000
// Groq's llama-3.3-70b caps output at 4096 tokens, so its chunks must be
// smaller than Gemini's for the output to fit without truncation.
const GROQ_CHUNK_CHAR_TARGET = 8000

function splitIntoChunks(text: string, target: number): string[] {
  if (text.length <= target) return [text]

  const paragraphs = text.split(/\n\s*\n/)
  const chunks: string[] = []
  let current = ''
  for (const p of paragraphs) {
    if (current && (current.length + p.length) > target) {
      chunks.push(current)
      current = p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current) chunks.push(current)
  return chunks
}

async function composeWithGemini(fullText: string, level: string, customInstructions: string, qTypes: string[]): Promise<string> {
  const chunks = splitIntoChunks(fullText, CHUNK_CHAR_TARGET)
  const model = getGeminiModel()

  if (chunks.length === 1) {
    const result = await model.generateContent(buildLessonFromFilePrompt(chunks[0], level, customInstructions, qTypes))
    return result.response.text()
  }

  // Long document: process each chunk independently (in order) and stitch
  // the results into one continuous lesson.
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const result = await model.generateContent(
      buildLessonFromFilePrompt(chunks[i], level, customInstructions, qTypes, { index: i, total: chunks.length })
    )
    parts.push(result.response.text())
  }
  return parts.join('\n\n')
}

async function composeWithFallbackChain(fullText: string, level: string, customInstructions: string, qTypes: string[]): Promise<{ content: string; provider: string }> {
  const chunks = splitIntoChunks(fullText, GROQ_CHUNK_CHAR_TARGET)
  const system = 'You transcribe source material into Markdown lesson pages faithfully, without adding or omitting content.'

  const parts: string[] = []
  let provider = 'none'
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? { index: i, total: chunks.length } : undefined
    const result = await aiChatDetailed(buildLessonFromFilePrompt(chunks[i], level, customInstructions, qTypes, part), system)
    parts.push(result.content)
    provider = result.provider
  }
  return { content: parts.join('\n\n'), provider }
}

async function composeLesson(fullText: string, level: string, customInstructions: string, qTypes: string[]): Promise<{ content: string; provider: string }> {
  // Gemini first (larger output window), then the aiChat chain
  // (Groq → xKiro → Cohere → OpenRouter) — e.g. when the Gemini free-tier
  // quota is exhausted (429) the teacher still gets a lesson.
  try {
    const content = await composeWithGemini(fullText, level, customInstructions, qTypes)
    return { content, provider: 'gemini' }
  } catch (e) {
    console.error('[composeLesson] Gemini failed, falling back to aiChat chain:', e instanceof Error ? e.message : e)
    return composeWithFallbackChain(fullText, level, customInstructions, qTypes)
  }
}
