import { buildLessonFromFilePrompt } from '@/content/ai/lesson-from-file'
import { aiChatDetailed, geminiCompose } from './chat'
import { AiProviderError, logAiFailure } from './meter'
import { PrivacyPendingError, type AiAudience } from './privacy'

// ── Lesson from a long source text ───────────────────────────────
// Gemini first (larger output window), then the aiChat chain
// (Groq → xKiro → Cohere → OpenRouter) — e.g. when the Gemini free-tier
// quota is exhausted (429) the teacher still gets a lesson.
//
// Time: the whole composition runs inside one budget (the route's maxDuration
// minus a margin). Gemini chunks run in parallel under one AbortController:
// when one chunk fails, the others are aborted, and the fallback starts only
// after EVERY Gemini call has settled, so each call is metered before the
// response is sent and no Gemini request is still running during the fallback.
// An abort stops our side of the request; it does not prove the provider did
// not process (or bill) it.

/** Whole-request budget for composition. maxDuration is 300 s; 30 s margin for
 *  extraction, the response and the usage write. Provisional, see PROGRESS. */
export const COMPOSE_BUDGET_MS = 270_000
/** Per-chunk Gemini timeout. A full chunk is up to ~32k output tokens, which
 *  does not fit the 25 s default (AI_TIMEOUT_MS). Provisional, see PROGRESS. */
export const GEMINI_CHUNK_TIMEOUT_MS = 120_000
/** Do not start a new fallback chunk with less time than this left. */
const MIN_CHUNK_START_MS = 30_000

// Splits on paragraph boundaries (never mid-sentence) once a chunk would
// approach Gemini's output ceiling, so long documents (~20+ pages) still
// come back complete instead of being cut off silently.
export const CHUNK_CHAR_TARGET = 24000
// Groq's gpt-oss-120b caps output at 4096 tokens, so its chunks must be
// smaller than Gemini's for the output to fit without truncation.
export const GROQ_CHUNK_CHAR_TARGET = 8000

export function splitIntoChunks(text: string, target: number): string[] {
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

export interface ComposeInput {
  fullText: string
  level: string
  customInstructions: string
  qTypes: string[]
  /** Kinds of content in the prompt. A source file is always institutional. */
  audiences: readonly AiAudience[]
  /** Absolute epoch ms by which composition must finish. */
  deadline: number
  /** Injected for tests. */
  now?: () => number
}

export async function composeWithGemini(input: ComposeInput): Promise<string> {
  const now = input.now ?? Date.now
  const chunks = splitIntoChunks(input.fullText, CHUNK_CHAR_TARGET)
  const controller = new AbortController()
  const timeoutMs = Math.max(1, Math.min(GEMINI_CHUNK_TIMEOUT_MS, input.deadline - now()))

  const run = (prompt: string) => geminiCompose(prompt, {
    audiences: input.audiences,
    timeoutMs,
    signal: controller.signal,
  }).catch(e => {
    // First failure: stop the siblings instead of letting them run to their timeout.
    controller.abort()
    throw e
  })

  const prompts = chunks.map((chunk, i) => buildLessonFromFilePrompt(
    chunk, input.level, input.customInstructions, input.qTypes,
    chunks.length > 1 ? { index: i, total: chunks.length } : undefined,
  ))
  // All chunks at once (each part takes a minute or two), joined in source order.
  const settled = await Promise.allSettled(prompts.map(run))
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) {
    // Prefer the original failure over the AbortErrors it caused in the siblings.
    const original = settled.find((r): r is PromiseRejectedResult =>
      r.status === 'rejected' && !(r.reason instanceof AiProviderError && r.reason.code === 'timeout' && controller.signal.aborted))
    throw (original ?? failed).reason
  }
  return settled.map(r => (r as PromiseFulfilledResult<string>).value).join('\n\n')
}

export async function composeWithFallbackChain(input: ComposeInput): Promise<{ content: string; provider: string }> {
  const now = input.now ?? Date.now
  const chunks = splitIntoChunks(input.fullText, GROQ_CHUNK_CHAR_TARGET)
  const system = 'You transcribe source material into Markdown lesson pages faithfully, without adding or omitting content.'

  const parts: string[] = []
  let provider = 'none'
  for (let i = 0; i < chunks.length; i++) {
    // Never start a chunk that cannot finish inside the budget.
    if (input.deadline - now() < MIN_CHUNK_START_MS) throw new AiProviderError('chain', 'budget')
    const part = chunks.length > 1 ? { index: i, total: chunks.length } : undefined
    const result = await aiChatDetailed(
      buildLessonFromFilePrompt(chunks[i], input.level, input.customInstructions, input.qTypes, part),
      system,
      { audiences: input.audiences, deadline: input.deadline },
    )
    parts.push(result.content)
    provider = result.provider
  }
  return { content: parts.join('\n\n'), provider }
}

export async function composeLesson(input: ComposeInput): Promise<{ content: string; provider: string }> {
  try {
    const content = await composeWithGemini(input)
    return { content, provider: 'gemini' }
  } catch (e) {
    // Content that no provider may receive: the chain would refuse it too.
    if (e instanceof PrivacyPendingError) throw e
    logAiFailure('[composeLesson] Gemini failed, falling back to aiChat chain:', e)
    return composeWithFallbackChain(input)
  }
}
