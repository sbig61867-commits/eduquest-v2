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
    ? `The teacher has provided specific instructions — follow them exactly (they OVERRIDE the default section choice; if the teacher names specific sections/tabs, use exactly those, in their order and language):
"""
${customInstructions}
"""
Platform format contract (applies regardless of the instructions above):
- Every section MUST start with a Markdown H2 heading (\`## Section Name\`) — each H2 renders as a separate tab. Use \`##\` ONLY for section boundaries.
- Unless the teacher explicitly says otherwise, keep exercises/questions out of content sections and end with a quiz section and a test section named in the source language.
- EVERY question MUST use this machine-readable format (it becomes an interactive quiz):

### Q1
Question text (use ________ for fill-in-the-blank)
- A) option
- B) option
**Answer:** B

Fill-in-the-blank questions have no option lines and the Answer is the exact missing word. Never put a combined "Answers" list at the end.`
    : `Organize the material into thematic sections. Each section MUST start with a Markdown H2 heading (\`## Section Name\`) — the platform renders every H2 section as a separate tab, so use \`##\` ONLY for section boundaries.

First detect the subject and the language of the source, then choose 2-4 content-section names that fit it. ALWAYS write every section name (including the two quiz sections below) in the SAME language as the source:
- Language-learning material: e.g. Vocabulary, Grammar, Idioms & Expressions, Examples.
- Science / math / history / other: e.g. Key Concepts, Definitions, Explanations, Examples, Formulas, Laws.
Include a section only if the source actually has that kind of content, but always produce AT LEAST TWO content sections by splitting the material into logical parts — never collapse everything into a single content tab.

STRICT content-placement rules:
- Content sections contain ONLY explanations, rules, definitions, lists, and WORKED examples (with their solutions shown). A "rules"/"grammar"/"concepts" section must EXPLAIN each point and show example(s).
- NO exercises, drills, fill-in-the-blanks, or questions of any kind in content sections. Every exercise or question found in the source MUST be moved into the quiz section instead.
- Do not omit source content and do not add facts that are not in the source.

Then ALWAYS end with exactly these two extra sections. Translate BOTH names into the source language — for an Arabic source they MUST be "اختبر نفسك" and "اختبار شامل"; for English keep "Quick Quiz" and "Comprehensive Test"; for any other language use the natural equivalent:
1. \`## <Quick Quiz in source language>\` — all exercises found in the source, plus short questions, totalling at least 5.
2. \`## <Comprehensive Test in source language>\` — 8-12 NEW questions covering ALL parts of the material (mix of multiple choice and fill-in-the-blank).

EVERY question in Quick Quiz and Comprehensive Test MUST use EXACTLY this machine-readable format (the platform turns it into an interactive quiz — deviating breaks it):

### Q1
Question text here (use ________ for fill-in-the-blank questions)
- A) first option
- B) second option
- C) third option
- D) fourth option
**Answer:** B

### Q2
Fill-in-the-blank question with ________ in it
**Answer:** the missing word

Rules for questions: multiple choice has 2-4 options and the Answer is the letter only. Fill-in-the-blank has NO option lines and the Answer is the exact missing word/phrase. Never put an "Answers" list at the end — each question carries its own **Answer:** line.`

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
