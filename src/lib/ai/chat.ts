import * as Sentry from '@sentry/nextjs'
import { groqChat } from './groq'

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
async function openAiCompatChat(opts: {
  url: string
  apiKey: string
  model: string
  /** OpenRouter-style fallback routing: alternate models tried upstream if the primary is congested. */
  models?: string[]
  prompt: string
  systemPrompt?: string
  headers?: Record<string, string>
  temperature?: number
}): Promise<string> {
  const res = await fetch(opts.url, {
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
  })
  if (!res.ok) throw new Error(`${opts.url} ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Provider returned no content')
  return content
}

// Cerebras dropped from the chain 2026-09-04 — free trial credit ran out and
// the account now returns 402 "Payment required", which the owner does not
// want to fix by adding billing (every provider here must stay free). See
// [[ai-provider-chain]] memory. Replaced by Cohere below, in the same slot.
function cohereChat(prompt: string, systemPrompt?: string, temperature?: number): Promise<string> {
  return openAiCompatChat({
    url: 'https://api.cohere.com/compatibility/v1/chat/completions',
    apiKey: process.env.COHERE_API_KEY!,
    // Cohere's flagship general-purpose model, OpenAI-compatible endpoint —
    // verified live 2026-09-04 (command-r-plus was retired by Cohere
    // 2025-09-15; the /v1/models list is the source of truth if this drifts).
    model: 'command-a-03-2025',
    prompt, systemPrompt, temperature,
  })
}

// xKiro (api.xkiro.com) — OpenAI-compatible aggregator, free tier verified
// live against GET /v1/models 2026-09-08 (40+ free-tier models, 5M
// tokens/day). deepseek/deepseek-v4-flash: free, 1M context, not a
// promo-tagged ":free" model, so less likely to be pulled than the others.
function xkiroChat(prompt: string, systemPrompt?: string, temperature?: number): Promise<string> {
  return openAiCompatChat({
    url: 'https://api.xkiro.com/v1/chat/completions',
    apiKey: process.env.XKIRO_API_KEY!,
    model: 'deepseek/deepseek-v4-flash',
    prompt, systemPrompt, temperature,
  })
}

function openRouterChat(prompt: string, systemPrompt?: string, temperature?: number): Promise<string> {
  return openAiCompatChat({
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
    prompt, systemPrompt, temperature,
    headers: { 'X-Title': 'EduQuest' },
  })
}

async function geminiChat(prompt: string, systemPrompt?: string, temperature?: number): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const { AI_TIMEOUT_MS } = await import('./timeout')
  // gemini-2.0-flash was retired by Google (404) — gemini-2.5-flash is the
  // current stable free-tier model, verified live.
  const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({
    model: 'gemini-2.5-flash',
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    ...(temperature != null ? { generationConfig: { temperature } } : {}),
  }, { timeout: AI_TIMEOUT_MS })
  const result = await model.generateContent(prompt)
  const text = result.response.text()
  if (!text) throw new Error('Gemini returned no content')
  return text
}

export interface AiChatOptions {
  /** Lower (e.g. 0.2-0.3) for strict source-grounded generation where
   * hallucination/invention is unacceptable; omit for the 0.7 default
   * (creative prose like lesson content). */
  temperature?: number
}

export async function aiChatDetailed(
  prompt: string,
  systemPrompt?: string,
  options?: AiChatOptions
): Promise<{ content: string; provider: string }> {
  const temperature = options?.temperature
  const legs: Array<[string, () => Promise<string>]> = []
  if (hasKey('GROQ_API_KEY')) legs.push(['groq', () => groqChat(prompt, systemPrompt, temperature ?? 0.7)])
  if (hasKey('XKIRO_API_KEY')) legs.push(['xkiro', () => xkiroChat(prompt, systemPrompt, temperature)])
  if (hasKey('COHERE_API_KEY')) legs.push(['cohere', () => cohereChat(prompt, systemPrompt, temperature)])
  if (hasKey('GEMINI_API_KEY')) legs.push(['gemini', () => geminiChat(prompt, systemPrompt, temperature)])
  if (hasKey('OPENROUTER_API_KEY')) legs.push(['openrouter', () => openRouterChat(prompt, systemPrompt, temperature)])

  if (legs.length === 0) throw new Error('No AI provider configured')

  let lastError: unknown
  const failed: string[] = []
  for (const [provider, run] of legs) {
    try {
      return { content: await run(), provider }
    } catch (e) {
      console.error(`[aiChat] ${provider} failed:`, e instanceof Error ? e.message : e)
      failed.push(provider)
      lastError = e
    }
  }

  // Every configured provider failed — this is the "all AI quota exhausted"
  // case that previously only showed up as a generic 500 to the end user
  // with nothing surfaced to an operator. Report it so it pages someone
  // instead of waiting for a user complaint.
  Sentry.captureException(lastError, {
    tags: { feature: 'ai-provider-chain' },
    extra: { attemptedProviders: failed },
  })
  throw lastError
}

export async function aiChat(prompt: string, systemPrompt?: string, options?: AiChatOptions): Promise<string> {
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

QUIZ (mandatory, always last, even if the teacher's instructions don't mention it)
End with a section whose H2 heading is the source language's equivalent of "Quick Quiz" (Arabic: "اختبر نفسك"), containing at least 5 questions in EXACTLY this shape:

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
  return aiChatDetailed(buildLessonPrompt(topic, level, customInstructions))
}
