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
    ? `The teacher has provided specific instructions for how to structure this content, follow them exactly:
"""
${customInstructions.trim()}
"""
Do not add sections that are not requested. Do not ignore sections that are requested.`
    : `Structure the lesson with:
1. Learning Objectives (3-5 bullet points)
2. Introduction
3. Main Content (broken into clear sections)
4. Key Concepts Summary
5. Practice Questions (5 questions)`

  return `Create a comprehensive educational lesson about "${topic}" for ${level} level students.

${structureBlock}

Format the response in Markdown.`
}

export function generateLessonContentAI(
  topic: string,
  level: string,
  customInstructions?: string
): Promise<{ content: string; provider: string }> {
  return aiChatDetailed(buildLessonPrompt(topic, level, customInstructions))
}
