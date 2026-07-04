import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { aiChat } from '@/lib/ai/chat'
import { extractTextFromFile, extractionErrorResponse } from '@/lib/ai/extract'

// gemini-2.0-flash caps a single response around 8192 output tokens (~24k
// chars). Groq's llama-3.3-70b-versatile caps at 4096 — Gemini gives a
// materially larger single-pass ceiling, which is why composition (not just
// vision extraction) now runs through it.
const GEMINI_MODEL = 'gemini-2.0-flash'
const MAX_OUTPUT_TOKENS = 8192

function getGeminiModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  return new GoogleGenerativeAI(key).getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  })
}

// ── Route ────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimit(`lesson-file:${user.id}`, { limit: 10, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let formData: FormData
  try { formData = await request.formData() }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  const customInstructions = (formData.get('instructions') as string | null)?.slice(0, 1000) ?? ''
  const level = (formData.get('level') as string | null) ?? 'undergraduate'

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  let fullText: string
  try {
    // No truncation — the teacher asked for the full source content, not a
    // summary, so cutting it at a fixed length would silently drop material.
    fullText = await extractTextFromFile(file)
  } catch (e) {
    console.error('[generate-lesson-from-file] extraction:', e)
    const { status, error } = extractionErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  try {
    const content = await composeLesson(fullText, level, customInstructions)
    return NextResponse.json({ content })
  } catch (e) {
    console.error('[generate-lesson-from-file] AI:', e)
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}

// ── Composition (organized into tabbed sections) ─────────────────

function buildPrompt(chunk: string, level: string, customInstructions: string, part?: { index: number; total: number }): string {
  const structureBlock = customInstructions.trim()
    ? `The teacher has provided specific instructions — follow them exactly:\n"""\n${customInstructions}\n"""`
    : `Organize the material into thematic sections. Each section MUST start with a Markdown H2 heading (\`## Section Name\`) — the platform renders every H2 section as a separate tab, so use \`##\` ONLY for section boundaries (use \`###\` and smaller inside a section).

Choose section names that fit the subject and write them in the SAME language as the source:
- Language-learning material (English, etc.): sections like Vocabulary, Grammar, Idioms & Expressions, Examples & Practice — include a section only if the source actually contains that kind of content.
- Other subjects (science, math, history, …): choose fitting sections such as Key Concepts, Definitions, Explanations, Examples, Formulas.
- Put ALL the source content into these sections — do not omit, shorten, or alter any of it, and do not add facts that are not in the source.

Then ALWAYS end with exactly these two extra sections (named in the source language, e.g. Arabic source → "اختبر نفسك" and "اختبار شامل"):
1. \`## Quick Quiz\` — 5 short questions (multiple choice or fill-in-the-blank) drawn strictly from this material, with an "Answers" list at the bottom of the section.
2. \`## Comprehensive Test\` — 8-12 questions covering ALL parts of the material (mix of MCQ, fill-in-the-blank, and short answer), with an "Answers" list at the bottom of the section.`

  const continuationNote = part && part.index > 0
    ? `\nThis is part ${part.index + 1} of ${part.total} of one longer document, already in progress — continue directly with this part's content. Do not repeat a title or restart with an introduction. Only produce the Quick Quiz and Comprehensive Test sections if this is the FINAL part (part ${part.total} of ${part.total}), covering the whole document.`
    : ''

  return `You are converting a teacher's source material into a structured lesson page.
Preserve the source content faithfully — do not invent information that is not present in it (quiz/test questions must be answerable from the material alone).
Keep the same language as the source material.

Level: ${level}
${structureBlock}${continuationNote}

Format in Markdown.

Source content:
${chunk}`
}

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

async function composeWithGemini(fullText: string, level: string, customInstructions: string): Promise<string> {
  const chunks = splitIntoChunks(fullText, CHUNK_CHAR_TARGET)
  const model = getGeminiModel()

  if (chunks.length === 1) {
    const result = await model.generateContent(buildPrompt(chunks[0], level, customInstructions))
    return result.response.text()
  }

  // Long document: process each chunk independently (in order) and stitch
  // the results into one continuous lesson.
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const result = await model.generateContent(
      buildPrompt(chunks[i], level, customInstructions, { index: i, total: chunks.length })
    )
    parts.push(result.response.text())
  }
  return parts.join('\n\n')
}

async function composeWithFallbackChain(fullText: string, level: string, customInstructions: string): Promise<string> {
  const chunks = splitIntoChunks(fullText, GROQ_CHUNK_CHAR_TARGET)
  const system = 'You transcribe source material into Markdown lesson pages faithfully, without adding or omitting content.'

  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? { index: i, total: chunks.length } : undefined
    parts.push(await aiChat(buildPrompt(chunks[i], level, customInstructions, part), system))
  }
  return parts.join('\n\n')
}

async function composeLesson(fullText: string, level: string, customInstructions: string): Promise<string> {
  // Gemini first (larger output window), then the aiChat chain
  // (Groq → Cerebras → OpenRouter) — e.g. when the Gemini free-tier quota
  // is exhausted (429) the teacher still gets a lesson.
  try {
    return await composeWithGemini(fullText, level, customInstructions)
  } catch (e) {
    console.error('[composeLesson] Gemini failed, falling back to aiChat chain:', e instanceof Error ? e.message : e)
    return composeWithFallbackChain(fullText, level, customInstructions)
  }
}
