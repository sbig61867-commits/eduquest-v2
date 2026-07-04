import { groqChat } from './groq'

// ── Unified AI chat with provider fallback ────────────────────────
// Tries providers in order and moves to the next on any error (quota
// exhausted, outage, etc.), so no single free tier is a point of failure:
//   Groq → Cerebras → Gemini → OpenRouter
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
      temperature: 0.7,
      max_tokens: 4096,
    }),
  })
  if (!res.ok) throw new Error(`${opts.url} ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Provider returned no content')
  return content
}

function cerebrasChat(prompt: string, systemPrompt?: string): Promise<string> {
  return openAiCompatChat({
    url: 'https://api.cerebras.ai/v1/chat/completions',
    apiKey: process.env.CEREBRAS_API_KEY!,
    // Cerebras free tier no longer serves Llama 3.3; gpt-oss-120b is the
    // strongest model on offer (verified live 2026-07-04).
    model: 'gpt-oss-120b',
    prompt, systemPrompt,
  })
}

function openRouterChat(prompt: string, systemPrompt?: string): Promise<string> {
  return openAiCompatChat({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.OPENROUTER_API_KEY!,
    // Free models get congested individually (429 upstream), so let
    // OpenRouter route across several — verified live 2026-07-04.
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'openai/gpt-oss-120b:free',
      'qwen/qwen3-next-80b-a3b-instruct:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
    ],
    prompt, systemPrompt,
    headers: { 'X-Title': 'EduQuest' },
  })
}

async function geminiChat(prompt: string, systemPrompt?: string): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({
    model: 'gemini-2.0-flash',
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
  })
  const result = await model.generateContent(prompt)
  const text = result.response.text()
  if (!text) throw new Error('Gemini returned no content')
  return text
}

export async function aiChatDetailed(
  prompt: string,
  systemPrompt?: string
): Promise<{ content: string; provider: string }> {
  const legs: Array<[string, () => Promise<string>]> = []
  if (hasKey('GROQ_API_KEY')) legs.push(['groq', () => groqChat(prompt, systemPrompt)])
  if (hasKey('CEREBRAS_API_KEY')) legs.push(['cerebras', () => cerebrasChat(prompt, systemPrompt)])
  if (hasKey('GEMINI_API_KEY')) legs.push(['gemini', () => geminiChat(prompt, systemPrompt)])
  if (hasKey('OPENROUTER_API_KEY')) legs.push(['openrouter', () => openRouterChat(prompt, systemPrompt)])

  if (legs.length === 0) throw new Error('No AI provider configured')

  let lastError: unknown
  for (const [provider, run] of legs) {
    try {
      return { content: await run(), provider }
    } catch (e) {
      console.error(`[aiChat] ${provider} failed:`, e instanceof Error ? e.message : e)
      lastError = e
    }
  }
  throw lastError
}

export async function aiChat(prompt: string, systemPrompt?: string): Promise<string> {
  return (await aiChatDetailed(prompt, systemPrompt)).content
}

// ── Shared lesson prompt (single source — was duplicated per provider) ──

export function buildLessonPrompt(topic: string, level: string, customInstructions?: string): string {
  const structureBlock = customInstructions?.trim()
    ? `The teacher has provided specific instructions for how to structure this content — follow them exactly:
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
