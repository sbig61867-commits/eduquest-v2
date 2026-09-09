import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { aiRateLimit } from '@/lib/rate-limit'
import { aiChatDetailed } from '@/lib/ai/chat'
import { logAiUsage } from '@/lib/ai/usage'
import { getAiRateLimits } from '@/lib/settings'

export const maxDuration = 300

// Generates homework questions STRICTLY from teacher-uploaded material.
// The teacher picks the question types (mcq / true_false / essay), the
// count, and can add free-form instructions. Output matches the Question
// shape used by the homework builder so the teacher reviews/edits before
// publishing.
//
// Takes already-extracted text (`sourceText`), not raw files — the client
// extracts each file individually via /api/ai/extract-file first (see
// src/lib/ai/extract-client.ts). Routing up to 10 raw files through one
// request routinely exceeded Vercel's ~4.5MB serverless body limit even
// though each file was small on its own; extracted text is a fraction of
// the size and easily fits.

interface GeneratedQuestion {
  id: string
  text: string
  type: 'mcq' | 'true_false' | 'essay'
  options: string[]
  correct_answer: string
  points: number
}

const TYPE_LABEL: Record<string, string> = {
  mcq: 'multiple choice (exactly 4 options)',
  true_false: 'true/false',
  essay: 'essay / open answer',
}

// Near-duplicate detection: same question asked twice is rejected even if
// wording differs slightly (case/punctuation/whitespace normalized).
function normalizeQ(text: string): string {
  return text.toLowerCase().replace(/[.,!؟?،:'"()\-ــ_]/g, '').replace(/\s+/g, ' ').trim()
}

// ── Grounding safety net ──────────────────────────────────────────
// A free-tier model occasionally ignores the "source only" instruction
// entirely and answers from its own training data instead — observed live:
// 10 files of an English-language course produced biology/physics trivia
// questions with zero connection to the uploaded material. The strict-JSON
// validation above only checks question SHAPE, not whether its CONTENT
// actually came from the source, so a fully-formed but hallucinated
// question sailed straight through. This is a cheap, non-AI heuristic
// safety net: a question genuinely written from the source material must
// share at least a couple of its distinctive words with it — one that
// shares none almost certainly wasn't.
const STOPWORDS = new Set([
  'this', 'that', 'these', 'those', 'with', 'from', 'what', 'which', 'when',
  'where', 'true', 'false', 'about', 'have', 'their', 'there', 'would',
  'could', 'should', 'into', 'your', 'they', 'them', 'then', 'than',
  'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'الذين', 'كان', 'كانت', 'وهو',
  'وهي', 'على', 'الى', 'إلى', 'من', 'في', 'عن', 'مع', 'بين', 'كل',
])

function significantWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []
  return new Set(words.filter(w => !STOPWORDS.has(w)))
}

function isGrounded(question: GeneratedQuestion, sourceVocab: Set<string>): boolean {
  const qWords = significantWords([question.text, ...question.options].join(' '))
  if (qWords.size === 0) return true // too short to judge either way (e.g. "True or false?")
  let shared = 0
  for (const w of qWords) if (sourceVocab.has(w)) shared++
  // Short/rephrased questions can legitimately share only one distinctive
  // term (e.g. a single vocabulary word being tested) — require just 1,
  // but reject the zero-overlap case that catches full hallucination.
  return shared >= 1
}

function validate(raw: unknown, allowed: Set<string>): GeneratedQuestion[] {
  if (!Array.isArray(raw)) throw new Error('AI did not return an array')
  const out: GeneratedQuestion[] = []
  for (const q of raw) {
    if (typeof q?.text !== 'string' || !q.text.trim()) continue
    const type = allowed.has(q.type) ? q.type : null
    if (!type) continue
    let options: string[] = []
    let correct = ''
    if (type === 'mcq') {
      options = Array.isArray(q.options) ? q.options.map(String).slice(0, 4) : []
      if (options.length !== 4) continue
      correct = String(q.correct_answer ?? '')
      if (!options.includes(correct)) continue
    } else if (type === 'true_false') {
      options = ['True', 'False']
      correct = String(q.correct_answer ?? '')
      if (!options.includes(correct)) continue
    }
    // essay: no options; correct_answer stays empty (graded manually) —
    // the model answer is appended to the question text for the teacher.
    out.push({
      id: `${Date.now()}-${out.length}`,
      text: q.text.trim(),
      type,
      options,
      correct_answer: correct,
      points: type === 'essay' ? 10 : type === 'mcq' ? 10 : 5,
    })
  }
  return out
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const aiLimits = await getAiRateLimits(supabase)
  const rl = await aiRateLimit(`homework-file:${user.id}`, { limit: aiLimits.exam_per_hour, windowSecs: 3600 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  let formData: FormData
  try { formData = await request.formData() }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const sourceText = ((formData.get('sourceText') as string | null) ?? '').trim()
  if (!sourceText) return NextResponse.json({ error: 'No source text provided' }, { status: 400 })

  const typesRaw = (formData.get('types') as string | null) ?? 'mcq,true_false'
  const allowed = new Set(typesRaw.split(',').map(t => t.trim()).filter(t => ['mcq', 'true_false', 'essay'].includes(t)))
  if (allowed.size === 0) return NextResponse.json({ error: 'No valid question types selected' }, { status: 400 })

  const count = Math.min(Math.max(parseInt((formData.get('count') as string) ?? '10', 10) || 10, 1), 120)
  const customInstructions = ((formData.get('instructions') as string | null) ?? '').slice(0, 1000).trim()

  const typeList = [...allowed].map(t => TYPE_LABEL[t]).join(', ')
  const instructionsBlock = customInstructions
    ? `\nThe teacher added these instructions — follow them (they may narrow the topic focus or style, but questions must STILL be answerable from the source alone):\n"""\n${customInstructions}\n"""`
    : ''

  function buildPrompt(n: number, avoid: string[]): string {
    // Cap the avoid list so 100+ question runs don't bloat the prompt.
    const avoidShort = avoid.slice(-60).map(t => t.slice(0, 90))
    const avoidBlock = avoidShort.length
      ? `\n- Do NOT repeat any of these already-generated questions (and do not rephrase them into near-duplicates):\n${avoidShort.map(t => `  • ${t}`).join('\n')}`
      : ''
    return `You are generating homework questions for university students.

STRICT RULES:
- Every question MUST be answerable using ONLY the source material below. Do not use outside knowledge, do not invent facts.
- Read the source material's actual subject first. Every question must be about THAT subject — e.g. if the source is an English-language course, do not write questions about biology, physics, history, or any other unrelated subject. If you find yourself writing a question that does not quote or directly reference something literally present in the source text below, do not write it.
- If the source material is too short or repetitive to produce ${n} truly unique questions from, generate FEWER questions instead of inventing unrelated content to reach the count.
- Use the SAME language as the source material.
- Generate exactly ${n} questions, using ONLY these types: ${typeList}. Mix the allowed types naturally.
- EVERY question must be UNIQUE — never ask the same thing twice. If the material is small and you must revisit the same point, change the FORMAT (e.g. ask it as multiple choice once and as true/false or essay the other time) and change the angle.${avoidBlock}
- Return ONLY a valid JSON array, no markdown, no explanation:
[
  {"text":"Question?","type":"mcq","options":["A","B","C","D"],"correct_answer":"A"},
  {"text":"True or false: ...","type":"true_false","options":["True","False"],"correct_answer":"True"},
  {"text":"Explain ... (essay)","type":"essay","options":[],"correct_answer":""}
]
- mcq: exactly 4 options, correct_answer must match one option exactly.
- true_false: options exactly ["True","False"].
- essay: options empty, correct_answer empty.${instructionsBlock}

=== SOURCE MATERIAL (the only allowed source) ===
${sourceText.slice(0, 30000)}`
  }

  const sourceVocab = significantWords(sourceText)

  try {
    // Batched generation, run through the generic aiChat() fallback chain —
    // Groq/Cohere/OpenRouter are all capped at max_tokens=4096 in chat.ts.
    // A batch of 30 full MCQ/JSON questions routinely exceeds that (verified
    // live: most rounds returned a 200 with the array truncated mid-object),
    // which silently produced 0 usable questions per round while still
    // burning the per-minute token budget and the per-hour request quota —
    // surfacing to teachers as "generated way fewer than requested" and,
    // after a couple of retries, "rate limit exceeded". 15 reliably fits
    // under 4096 tokens even for verbose questions.
    const BATCH = 15
    const maxRounds = Math.ceil(count / BATCH) + 2
    const seen = new Set<string>()
    const collected: GeneratedQuestion[] = []
    let lastProvider = 'none'

    // Questions already in the teacher's draft (earlier generation runs) —
    // seed both dedup layers so new runs never repeat them.
    let priorTexts: string[] = []
    try { priorTexts = JSON.parse((formData.get('avoid') as string | null) ?? '[]') } catch { /* optional */ }
    priorTexts = priorTexts.filter((t): t is string => typeof t === 'string').slice(-100)
    for (const t of priorTexts) seen.add(normalizeQ(t))

    for (let round = 0; round < maxRounds && collected.length < count; round++) {
      const need = Math.min(count - collected.length, BATCH)
      const { content, provider } = await aiChatDetailed(
        buildPrompt(need, [...priorTexts, ...collected.map(q => q.text)]),
        'Return only valid JSON arrays, no markdown, no explanations.',
        { temperature: 0.3 } // strict source-grounding, not creative writing
      )
      lastProvider = provider
      const text = content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '')
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) continue
      // A single malformed/truncated batch (the model hit its output cap
      // mid-array, or added a stray character) must not discard every
      // question already collected from earlier successful rounds — skip
      // the round and let the remaining rounds' retry headroom cover it.
      let parsed: unknown
      try { parsed = JSON.parse(match[0]) } catch (e) {
        console.error('[generate-homework-from-file] bad JSON batch:', e instanceof Error ? e.message : e)
        continue
      }
      for (const q of validate(parsed, allowed)) {
        const key = normalizeQ(q.text)
        if (seen.has(key)) continue
        if (!isGrounded(q, sourceVocab)) {
          console.error('[generate-homework-from-file] rejected ungrounded question:', q.text.slice(0, 120))
          continue
        }
        seen.add(key)
        q.id = `${Date.now()}-${collected.length}`
        collected.push(q)
        if (collected.length === count) break
      }
    }

    if (collected.length === 0) throw new Error('No valid questions after validation')
    void logAiUsage(user.id, profile.tenant_id, 'homework-from-file', lastProvider)
    return NextResponse.json({ questions: collected, requested: count, delivered: collected.length })
  } catch (e) {
    console.error('[generate-homework-from-file] AI:', e)
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}
