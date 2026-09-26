import type { SupabaseClient } from '@supabase/supabase-js'

// ── AI model prices ──────────────────────────────────────────────
// Every provider in the chain runs on its FREE tier, so nothing is actually
// billed. These are the providers' published PAID prices for the same model,
// so the usage dashboard can show what the platform's AI usage WOULD cost —
// the number that matters when pricing plans for institutions, or if a
// provider ever has to move to a paid tier.
//
// USD per 1,000,000 tokens. Verified 2026-09-26 against the providers' own
// price lists (Groq, Google AI Studio, Cohere) and OpenRouter's /api/v1/models
// for the models only served free here (xKiro's DeepSeek, OpenRouter's :free
// routing). The super_admin can override any of them, add new models, and
// mark a provider as billed from /super-admin/ai-usage (platform_settings key
// `ai_pricing`); the override is merged over these defaults.

export interface ModelPrice {
  /** USD per 1M input (prompt) tokens */
  input: number
  /** USD per 1M output (completion + reasoning) tokens */
  output: number
}

export interface AiPricing {
  models: Record<string, ModelPrice>
  /** Providers whose calls are actually charged. Empty = everything is free. */
  billedProviders: string[]
}

export const DEFAULT_AI_PRICING: AiPricing = {
  models: {
    'openai/gpt-oss-120b':               { input: 0.15,  output: 0.60 },  // Groq
    'deepseek/deepseek-v4-flash':        { input: 0.047, output: 0.094 }, // xKiro (free) — OpenRouter list price
    'command-a-03-2025':                 { input: 2.50,  output: 10.00 }, // Cohere
    'gemini-2.5-flash':                  { input: 0.30,  output: 2.50 },  // Google (text/image input)
    'z-ai/glm-5.2':                      { input: 0.65,  output: 2.04 },  // OpenRouter fallback
    'nvidia/nemotron-3-super-120b-a12b': { input: 0.08,  output: 0.45 },  // OpenRouter fallback
    'minimax/minimax-m3':                { input: 0.30,  output: 1.20 },  // OpenRouter fallback
  },
  billedProviders: [],
}

/** The model id used as the price key: OpenRouter's free routing suffix is
 *  dropped, so `z-ai/glm-5.2:free` is priced as `z-ai/glm-5.2`. */
export function priceKey(model: string): string {
  return model.trim().replace(/:free$/i, '')
}

export function priceFor(pricing: AiPricing, model: string | null | undefined): ModelPrice | null {
  if (!model) return null
  return pricing.models[priceKey(model)] ?? null
}

/** USD for one call at the given price. */
export function costUsd(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

function isPrice(v: unknown): v is ModelPrice {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return typeof p.input === 'number' && typeof p.output === 'number'
    && Number.isFinite(p.input) && Number.isFinite(p.output) && p.input >= 0 && p.output >= 0
}

/** Merges a stored `ai_pricing` value over the defaults, dropping anything malformed. */
export function mergeAiPricing(stored: unknown): AiPricing {
  const v = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<Record<keyof AiPricing, unknown>>
  const models: Record<string, ModelPrice> = { ...DEFAULT_AI_PRICING.models }
  if (typeof v.models === 'object' && v.models !== null) {
    for (const [k, p] of Object.entries(v.models as Record<string, unknown>)) {
      if (isPrice(p)) models[priceKey(k)] = { input: p.input, output: p.output }
    }
  }
  const billedProviders = Array.isArray(v.billedProviders)
    ? v.billedProviders.filter((x): x is string => typeof x === 'string')
    : DEFAULT_AI_PRICING.billedProviders
  return { models, billedProviders }
}

export async function readAiPricing(supabase: SupabaseClient): Promise<AiPricing> {
  const { data } = await supabase
    .from('platform_settings').select('value').eq('key', 'ai_pricing').maybeSingle()
  return mergeAiPricing(data?.value)
}
