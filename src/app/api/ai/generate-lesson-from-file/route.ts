import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { aiChat } from '@/lib/ai/chat'
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Limit comes from super-admin settings (ai_rate_limits.lesson_per_hour),
  // same as topic-based lesson generation — no more hardcoded 10.
  const aiLimits = await getAiRateLimits(supabase)
  const rl = await rateLimit(`lesson-file:${user.id}`, { limit: aiLimits.lesson_per_hour, windowSecs: 3600 })
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

  // Teacher-selected question types for the quiz/test tabs (toggle chips in
  // the UI). Sanitized to the known set; empty/absent → auto-gradable pair.
  const ALLOWED_QTYPES = ['true_false', 'mcq', 'essay'] as const
  let questionTypes: string[] = []
  try { questionTypes = JSON.parse((formData.get('question_types') as string | null) ?? '[]') } catch { /* default below */ }
  questionTypes = questionTypes.filter(t => (ALLOWED_QTYPES as readonly string[]).includes(t))
  if (questionTypes.length === 0) questionTypes = ['true_false', 'mcq']

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
    const content = await composeLesson(fullText, level, customInstructions, questionTypes)
    return NextResponse.json({ content })
  } catch (e) {
    console.error('[generate-lesson-from-file] AI:', e)
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}

// ── Composition (organized into tabbed sections) ─────────────────

function questionTypesClause(qTypes: string[]): string {
  const LABEL: Record<string, string> = {
    true_false: 'true/false (options exactly: - A) True / - B) False)',
    mcq: 'multiple choice with 4 options',
    essay: 'open/essay questions (NO option lines; put a model answer after **Answer:**)',
  }
  return `In the quiz and test sections use ONLY these question types, chosen by the teacher: ${qTypes.map(t => LABEL[t]).join(' + ')}. Never use any other type.`
}

function buildPrompt(chunk: string, level: string, customInstructions: string, qTypes: string[], part?: { index: number; total: number }): string {
  const structureBlock = customInstructions.trim()
    ? `The teacher has provided specific instructions — follow them exactly (they OVERRIDE the default section choice; if the teacher names specific sections/tabs, use exactly those, in their order and language):
"""
${customInstructions}
"""
Platform format contract (applies regardless of the instructions above):
- Every section MUST start with a Markdown H2 heading (\`## Section Name\`) — each H2 renders as a separate tab. Use \`##\` ONLY for section boundaries.
- Keep exercises/questions out of content sections.
- The lesson MUST ALWAYS end with a quick-quiz section and a comprehensive-test section (named in the source language, e.g. "اختبر نفسك" / "اختبار شامل" for Arabic, "Quick Quiz" / "Comprehensive Test" for English) — these two tabs are mandatory for every subject and CANNOT be dropped, even if the teacher's section list doesn't mention them. The teacher's instructions control the QUESTION TYPES inside them (e.g. "أسئلة صح وخطأ فقط" → true/false only) but never their existence.
- If the teacher asks for a task/assignment section (مهمة), add a \`## Task\` tab (named in the source language, e.g. "المهمة") BEFORE the quiz sections, containing the assignment exactly as the teacher describes it.
- EVERY question MUST use this machine-readable format (it becomes an interactive quiz):

### Q1
Question text (use ________ for fill-in-the-blank)
- A) option
- B) option
**Answer:** B

Fill-in-the-blank questions have no option lines and the Answer is the exact missing word. Never put a combined "Answers" list at the end.
- In language lessons, vocabulary/idiom items use \`- **term** — simple English explanation ||الترجمة العربية||\` (explanation in simple English; Arabic ONLY inside ||...||, shown to the student on demand). If the source pairs words directly with Arabic, write your own simple English explanation and move the Arabic into ||...||. Infer category headings lost by PDF extraction (Kitchen, Bathroom, …) and render them as \`### Heading\` lines grouping their items.
- Examples in content sections are shown ALREADY SOLVED with the answer wrapped in ==double equals== (highlighted green), e.g. "There ==is== a car." — unsolved exercises belong in quiz sections only.`
    : `Organize the material into thematic sections. Each section MUST start with a Markdown H2 heading (\`## Section Name\`) — the platform renders every H2 section as a separate tab, so use \`##\` ONLY for section boundaries.

First detect the subject and the language of the source, then choose 2-4 content-section names that fit it. ALWAYS write every section name (including the two quiz sections below) in the SAME language as the source:
- Language-learning material: e.g. Vocabulary, Grammar, Idioms & Expressions, Examples.
  In Vocabulary and Idioms sections, write EVERY item on its own line EXACTLY as:
  \`- **term** — simple English explanation ||الترجمة العربية||\`
  (bold term, then a dash, then a SHORT explanation in simple English so the student learns through English, then the Arabic translation inside ||double pipes|| — the platform hides the Arabic behind a "ترجمة" button and adds a pronunciation button to the term. NEVER translate idioms into Arabic in the visible explanation; Arabic goes ONLY inside ||...||.)
  If the source is a word list that pairs each English word with its Arabic translation directly, do NOT show the Arabic as the explanation — WRITE YOUR OWN simple English explanation for the visible part and put the source's Arabic translation inside ||...||.
  The same applies to idioms: even if the source translates an idiom straight into Arabic, first explain it in simple English (English-to-simple-English), Arabic only inside ||...||.
  PDF extraction loses bold/colored formatting, so category headings (e.g. Kitchen, Bathroom, Rooms) arrive flattened into the word stream — infer them from meaning and render each as a \`### Heading\` line, grouping its related vocabulary items beneath it, in the source's order.
- Science / math / history / other: e.g. Key Concepts, Definitions, Explanations, Examples, Formulas, Laws.
Include a section only if the source actually has that kind of content, but always produce AT LEAST TWO content sections by splitting the material into logical parts — never collapse everything into a single content tab.

STRICT content-placement rules:
- Content sections contain ONLY explanations, rules, definitions, lists, and WORKED examples (with their solutions shown). A "rules"/"grammar"/"concepts" section must EXPLAIN each point and show example(s).
- Every example in content sections MUST be shown ALREADY SOLVED, with the answer wrapped in ==double equals== so the platform highlights it in green — e.g. "There ==is== a car in the garage." / "==Is there== a boy in the room?". Never leave a blank (________) unsolved in a content section.
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
${structureBlock}
${questionTypesClause(qTypes)}${continuationNote}

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

async function composeWithGemini(fullText: string, level: string, customInstructions: string, qTypes: string[]): Promise<string> {
  const chunks = splitIntoChunks(fullText, CHUNK_CHAR_TARGET)
  const model = getGeminiModel()

  if (chunks.length === 1) {
    const result = await model.generateContent(buildPrompt(chunks[0], level, customInstructions, qTypes))
    return result.response.text()
  }

  // Long document: process each chunk independently (in order) and stitch
  // the results into one continuous lesson.
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const result = await model.generateContent(
      buildPrompt(chunks[i], level, customInstructions, qTypes, { index: i, total: chunks.length })
    )
    parts.push(result.response.text())
  }
  return parts.join('\n\n')
}

async function composeWithFallbackChain(fullText: string, level: string, customInstructions: string, qTypes: string[]): Promise<string> {
  const chunks = splitIntoChunks(fullText, GROQ_CHUNK_CHAR_TARGET)
  const system = 'You transcribe source material into Markdown lesson pages faithfully, without adding or omitting content.'

  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? { index: i, total: chunks.length } : undefined
    parts.push(await aiChat(buildPrompt(chunks[i], level, customInstructions, qTypes, part), system))
  }
  return parts.join('\n\n')
}

async function composeLesson(fullText: string, level: string, customInstructions: string, qTypes: string[]): Promise<string> {
  // Gemini first (larger output window), then the aiChat chain
  // (Groq → Cerebras → OpenRouter) — e.g. when the Gemini free-tier quota
  // is exhausted (429) the teacher still gets a lesson.
  try {
    return await composeWithGemini(fullText, level, customInstructions, qTypes)
  } catch (e) {
    console.error('[composeLesson] Gemini failed, falling back to aiChat chain:', e instanceof Error ? e.message : e)
    return composeWithFallbackChain(fullText, level, customInstructions, qTypes)
  }
}
