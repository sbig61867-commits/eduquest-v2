import { INTERACTIVE_BLOCKS } from '@/content/ai/lesson-from-file'
import * as Sentry from '@sentry/nextjs'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { QUIZ_SECTION_NAMES } from '@/content/ai'
import { groqChat } from './groq'
import { AiProviderError, geminiProviderError, geminiUsage, logAiFailure, meterCall } from './meter'
import { PrivacyPendingError, audienceApproved, providerApproved, type AiAudience } from './privacy'
import { AI_TIMEOUT_MS, aiTimeoutSignal, callTimeoutMs, isAbortError } from './timeout'
import { APP_NAME } from '@/lib/brand'

// ── Unified AI chat with provider fallback ────────────────────────
// Tries providers in order and moves to the next on any error (quota
// exhausted, outage, etc.), so no single free tier is a point of failure:
//   Groq → xKiro → Cohere → Gemini → OpenRouter
// A provider is skipped when its key is missing or still a placeholder,
// so new providers activate simply by adding their env var.

const PLACEHOLDER = /^your[_-]/i

function hasKey(name: string): boolean {
  const v = process.env[name]
  return !!v && !PLACEHOLDER.test(v)
}

// Groq/Cerebras/OpenRouter all speak the OpenAI chat-completions dialect.
// Every call is metered (tokens from the provider's `usage` block) — see meter.ts.
async function openAiCompatChat(opts: {
  /** Ledger name of the provider, e.g. 'cohere'. */
  provider: string
  url: string
  apiKey: string
  model: string
  /** OpenRouter-style fallback routing: alternate models tried upstream if the primary is congested. */
  models?: string[]
  prompt: string
  systemPrompt?: string
  headers?: Record<string, string>
  temperature?: number
  audiences: readonly AiAudience[]
  timeoutMs?: number
}): Promise<string> {
  const promptChars = opts.prompt.length + (opts.systemPrompt?.length ?? 0)
  return meterCall(opts.provider, opts.model, promptChars, opts.audiences, async () => {
    let res: Response
    try {
      res = await fetch(opts.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          ...opts.headers,
        },
        body: JSON.stringify({
          model: opts.model,
          ...(opts.models ? { models: opts.models } : {}),
          messages: [
            ...(opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []),
            { role: 'user', content: opts.prompt },
          ],
          temperature: opts.temperature ?? 0.7,
          max_tokens: 4096,
        }),
        // Same bound as Groq: a hung provider must not hold the function open.
        signal: aiTimeoutSignal(opts.timeoutMs),
      })
    } catch (err) {
      if (isAbortError(err)) throw new AiProviderError(opts.provider, 'timeout')
      throw new AiProviderError(opts.provider, 'network')
    }
    if (!res.ok) {
      // The body can echo the prompt: discard it, keep the status only.
      await res.body?.cancel().catch(() => {})
      throw new AiProviderError(opts.provider, String(res.status))
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new AiProviderError(opts.provider, 'empty')
    return {
      value: content as string,
      // OpenRouter reports the model it actually routed to.
      model: typeof data.model === 'string' ? data.model : undefined,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      outputChars: content.length,
    }
  })
}

// Cerebras dropped from the chain 2026-09-04 — free trial credit ran out and
// the account now returns 402 "Payment required", which the owner does not
// want to fix by adding billing (every provider here must stay free). See
// [[ai-provider-chain]] memory. Replaced by Cohere below, in the same slot.
function cohereChat(prompt: string, systemPrompt: string | undefined, temperature: number | undefined, audiences: readonly AiAudience[], timeoutMs?: number): Promise<string> {
  return openAiCompatChat({
    provider: 'cohere',
    url: 'https://api.cohere.com/compatibility/v1/chat/completions',
    apiKey: process.env.COHERE_API_KEY!,
    // Cohere's flagship general-purpose model, OpenAI-compatible endpoint —
    // verified live 2026-09-04 (command-r-plus was retired by Cohere
    // 2025-09-15; the /v1/models list is the source of truth if this drifts).
    model: 'command-a-03-2025',
    prompt, systemPrompt, temperature, audiences, timeoutMs,
  })
}

// xKiro (api.xkiro.com) — OpenAI-compatible aggregator, free tier verified
// live against GET /v1/models 2026-09-08 (40+ free-tier models, 5M
// tokens/day). deepseek/deepseek-v4-flash: free, 1M context, not a
// promo-tagged ":free" model, so less likely to be pulled than the others.
function xkiroChat(prompt: string, systemPrompt: string | undefined, temperature: number | undefined, audiences: readonly AiAudience[], timeoutMs?: number): Promise<string> {
  return openAiCompatChat({
    provider: 'xkiro',
    url: 'https://api.xkiro.com/v1/chat/completions',
    apiKey: process.env.XKIRO_API_KEY!,
    model: 'deepseek/deepseek-v4-flash',
    prompt, systemPrompt, temperature, audiences, timeoutMs,
  })
}

function openRouterChat(prompt: string, systemPrompt: string | undefined, temperature: number | undefined, audiences: readonly AiAudience[], timeoutMs?: number): Promise<string> {
  return openAiCompatChat({
    provider: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.OPENROUTER_API_KEY!,
    // Free models get congested/retired individually, so let OpenRouter
    // route across several — OpenRouter now caps `models` at 3 entries
    // (previously 4). meta-llama/llama-3.3-70b-instruct:free and
    // openai/gpt-oss-120b:free were dropped from OpenRouter's free tier —
    // this list re-verified live against /api/v1/models 2026-09-03.
    model: 'z-ai/glm-5.2:free',
    models: [
      'z-ai/glm-5.2:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'minimax/minimax-m3:free',
    ],
    prompt, systemPrompt, temperature, audiences, timeoutMs,
    headers: { 'X-Title': APP_NAME },
  })
}

async function geminiChat(prompt: string, systemPrompt: string | undefined, temperature: number | undefined, audiences: readonly AiAudience[], timeoutMs?: number): Promise<string> {
  // gemini-2.0-flash was retired by Google (404) — gemini-2.5-flash is the
  // current stable free-tier model, verified live.
  const modelId = 'gemini-2.5-flash'
  const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({
    model: modelId,
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    ...(temperature != null ? { generationConfig: { temperature } } : {}),
  }, { timeout: timeoutMs ?? AI_TIMEOUT_MS })
  return meterCall('gemini', modelId, prompt.length + (systemPrompt?.length ?? 0), audiences, async () => {
    let result
    let text: string
    try {
      result = await model.generateContent(prompt)
      text = result.response.text()
    } catch (e) {
      throw geminiProviderError(e)
    }
    if (!text) throw new AiProviderError('gemini', 'empty')
    return { value: text, ...geminiUsage(result.response), outputChars: text.length }
  })
}

// ── Gemini long-output composition (lesson-from-file) ────────────
// Lives here, not in the route, so every provider call is in src/lib/ai and
// passes through meterCall() and its privacy check.

export const GEMINI_COMPOSE_MODEL = 'gemini-2.5-flash'
// 2.5-flash allows 65k output tokens, but by default it also "thinks" first and
// those thinking tokens are taken out of the SAME budget — with the old 8192
// cap most of it went to thinking and the lesson came back a fraction of the
// file (owner report 2026-10-09). Thinking off + a large cap = the whole budget
// goes into the lesson.
const GEMINI_COMPOSE_MAX_OUTPUT_TOKENS = 32768

export interface GeminiComposeOptions {
  /** Required. Kinds of content in the prompt (privacy.ts). */
  audiences: readonly AiAudience[]
  /** Per-call timeout in ms; the SDK aborts the request. Defaults to AI_TIMEOUT_MS. */
  timeoutMs?: number
  /** Aborts the call early, e.g. when a sibling chunk failed. */
  signal?: AbortSignal
}

/** One metered, privacy-checked Gemini call for long-form output. Throws only
 *  PrivacyPendingError (before any request) or AiProviderError. */
export async function geminiCompose(prompt: string, opts: GeminiComposeOptions): Promise<string> {
  return meterCall('gemini', GEMINI_COMPOSE_MODEL, prompt.length, opts.audiences, async () => {
    const key = process.env.GEMINI_API_KEY
    if (!key) throw new AiProviderError('gemini', 'not_configured')
        const model = new GoogleGenerativeAI(key).getGenerativeModel({
      model: GEMINI_COMPOSE_MODEL,
      // thinkingConfig is not in this SDK's types yet; the API accepts it as is.
      generationConfig: { maxOutputTokens: GEMINI_COMPOSE_MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingBudget: 0 } } as Record<string, unknown>,
    }, { timeout: opts.timeoutMs ?? AI_TIMEOUT_MS })
    let result
    let text: string
    try {
      result = await model.generateContent(prompt, opts.signal ? { signal: opts.signal } : undefined)
      text = result.response.text()
    } catch (e) {
      throw geminiProviderError(e)
    }
    return { value: text, ...geminiUsage(result.response), outputChars: text.length }
  })
}

export interface AiChatOptions {
  /** Lower (e.g. 0.2-0.3) for strict source-grounded generation where
   * hallucination/invention is unacceptable; omit for the 0.7 default
   * (creative prose like lesson content). */
  temperature?: number
  /** Required. Kinds of content in the prompt (privacy.ts). A provider receives
   * the prompt only if it is approved for every audience listed. There is no
   * default: a missing, empty or unknown audience is refused before any call. */
  audiences: readonly AiAudience[]
  /** Absolute epoch ms. No provider is started once it has passed, and each
   *  provider call's timeout is cut to the time left (callTimeoutMs). */
  deadline?: number
}

export async function aiChatDetailed(
  prompt: string,
  systemPrompt: string | undefined,
  options: AiChatOptions
): Promise<{ content: string; provider: string }> {
  const temperature = options?.temperature
  const audiences = options?.audiences
  // Nothing approved for this content, or no valid audience: refuse before any call.
  if (!audienceApproved(audiences)) throw new PrivacyPendingError(Array.isArray(audiences) ? audiences.map(String) : [])

  const approved = (name: string) => providerApproved(name, audiences)
  const legs: Array<[string, (timeoutMs: number) => Promise<string>]> = []
  if (hasKey('GROQ_API_KEY') && approved('groq')) legs.push(['groq', t => groqChat(prompt, systemPrompt, temperature ?? 0.7, audiences, { timeoutMs: t })])
  if (hasKey('XKIRO_API_KEY') && approved('xkiro')) legs.push(['xkiro', t => xkiroChat(prompt, systemPrompt, temperature, audiences, t)])
  if (hasKey('COHERE_API_KEY') && approved('cohere')) legs.push(['cohere', t => cohereChat(prompt, systemPrompt, temperature, audiences, t)])
  if (hasKey('GEMINI_API_KEY') && approved('gemini')) legs.push(['gemini', t => geminiChat(prompt, systemPrompt, temperature, audiences, t)])
  if (hasKey('OPENROUTER_API_KEY') && approved('openrouter')) legs.push(['openrouter', t => openRouterChat(prompt, systemPrompt, temperature, audiences, t)])

  if (legs.length === 0) throw new Error('No AI provider configured')

  let lastError: unknown
  const failed: string[] = []
  for (const [provider, run] of legs) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      lastError = new AiProviderError('chain', 'budget')
      break
    }
    try {
      return { content: await run(callTimeoutMs(options.deadline)), provider }
    } catch (e) {
      logAiFailure(`[aiChat] ${provider} failed:`, e)
      failed.push(provider)
      lastError = e
    }
  }

  // Every configured provider failed — this is the "all AI quota exhausted"
  // case that previously only showed up as a generic 500 to the end user
  // with nothing surfaced to an operator. Report it so it pages someone
  // instead of waiting for a user complaint. Names only: the original errors
  // could carry provider text, so they never go to Sentry.
  Sentry.captureException(new Error(`AI provider chain failed: ${failed.join(', ')}`), {
    tags: { feature: 'ai-provider-chain' },
    extra: { attemptedProviders: failed },
  })
  throw lastError
}

export async function aiChat(prompt: string, systemPrompt: string | undefined, options: AiChatOptions): Promise<string> {
  return (await aiChatDetailed(prompt, systemPrompt, options)).content
}

// ── Shared lesson prompt (single source — was duplicated per provider) ──

export function buildLessonPrompt(topic: string, level: string, customInstructions?: string): string {
  const structureBlock = customInstructions?.trim()
    ? `The teacher has provided specific instructions for how to structure this content, follow them exactly (they OVERRIDE the default section list below; if the teacher names specific sections, use exactly those, in their order):
"""
${customInstructions.trim()}
"""
Do not add sections that are not requested. Do not ignore sections that are requested.`
    : `Use these sections, in this order:
1. Learning Objectives (3-5 bullet points)
2. Introduction
3. Main Content (split into as many sections as the topic needs)
4. Key Concepts Summary`

  // The lesson viewer (components/shared/lesson-tabs.tsx) turns every H2 into
  // a tab and parses "### question / options / answer" blocks into an
  // interactive quiz. A prompt that doesn't ask for that shape produces one
  // flat wall of Markdown with dead, un-answerable practice questions — which
  // is what the topic-based generator used to return. Keep these rules in
  // sync with generate-lesson-from-file/route.ts, which teaches the same
  // format from an uploaded source.
  return `Create a comprehensive educational lesson about "${topic}", aimed at ${level} level students.

LANGUAGE
- Write the ENTIRE lesson in the SAME language as the topic above. If the topic is in Arabic, every heading, sentence, question and option must be in Arabic. Never answer in English for an Arabic topic.
- Translate the section names into that language too.

FORMAT
- Every section MUST start with a Markdown H2 heading (\`## Section Name\`). Each H2 becomes a separate tab in the platform, so use \`##\` ONLY for section boundaries.
- Inside a section use \`###\` for sub-headings, \`-\` for bullets and \`**bold**\` for key terms.

${structureBlock}

${INTERACTIVE_BLOCKS}

QUIZ (mandatory, always last, even if the teacher's instructions don't mention it)
End with a section whose H2 heading is the source language's equivalent of "Quick Quiz" (Arabic: "${QUIZ_SECTION_NAMES.ar.quiz}"), containing at least 5 questions in EXACTLY this shape:

### <the question text>
- A) <option>
- B) <option>
- C) <option>
- D) <option>
Answer: B

Rules for that block: one \`###\` per question, exactly 4 options labelled A) to D), and a final \`Answer:\` line naming the correct letter. The platform parses this into an interactive quiz, so any other shape renders as dead text.

Return only the lesson in Markdown, with no preamble or closing commentary.`
}

export function generateLessonContentAI(
  topic: string,
  level: string,
  customInstructions?: string
): Promise<{ content: string; provider: string }> {
  // From generate-lesson only a topic and a fixed level arrive (public).
  // Free-text instructions are institutional content.
  const audiences: AiAudience[] = customInstructions?.trim() ? ['institution'] : ['public']
  return aiChatDetailed(buildLessonPrompt(topic, level, customInstructions), undefined, { audiences })
}
