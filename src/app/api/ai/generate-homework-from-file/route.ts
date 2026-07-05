import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { aiChat } from '@/lib/ai/chat'
import { extractTextFromFile, extractionErrorResponse } from '@/lib/ai/extract'
import { getAiRateLimits } from '@/lib/settings'

// Generates homework questions STRICTLY from a teacher-uploaded file.
// The teacher picks the question types (mcq / true_false / essay), the
// count, and can add free-form instructions. Output matches the Question
// shape used by the homework builder so the teacher reviews/edits before
// publishing.

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
    .from('users').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'university_admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const aiLimits = await getAiRateLimits(supabase)
  const rl = await rateLimit(`homework-file:${user.id}`, { limit: aiLimits.exam_per_hour, windowSecs: 3600 })
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
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const typesRaw = (formData.get('types') as string | null) ?? 'mcq,true_false'
  const allowed = new Set(typesRaw.split(',').map(t => t.trim()).filter(t => ['mcq', 'true_false', 'essay'].includes(t)))
  if (allowed.size === 0) return NextResponse.json({ error: 'No valid question types selected' }, { status: 400 })

  const count = Math.min(Math.max(parseInt((formData.get('count') as string) ?? '10', 10) || 10, 1), 30)
  const customInstructions = ((formData.get('instructions') as string | null) ?? '').slice(0, 1000).trim()

  let sourceText: string
  try {
    sourceText = await extractTextFromFile(file)
  } catch (e) {
    console.error('[generate-homework-from-file] extraction:', e)
    const { status, error } = extractionErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  const typeList = [...allowed].map(t => TYPE_LABEL[t]).join(', ')
  const instructionsBlock = customInstructions
    ? `\nThe teacher added these instructions — follow them (they may narrow the topic focus or style, but questions must STILL be answerable from the source alone):\n"""\n${customInstructions}\n"""`
    : ''

  const prompt = `You are generating homework questions for university students.

STRICT RULES:
- Every question MUST be answerable using ONLY the source material below. Do not use outside knowledge, do not invent facts.
- Use the SAME language as the source material.
- Generate exactly ${count} questions, using ONLY these types: ${typeList}. Mix the allowed types naturally.
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
${sourceText.slice(0, 12000)}`

  try {
    const content = await aiChat(prompt, 'Return only valid JSON arrays, no markdown, no explanations.')
    const text = content.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '')
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON array in AI response')
    const questions = validate(JSON.parse(match[0]), allowed)
    if (questions.length === 0) throw new Error('No valid questions after validation')
    return NextResponse.json({ questions })
  } catch (e) {
    console.error('[generate-homework-from-file] AI:', e)
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 })
  }
}
