import { AsyncLocalStorage } from 'node:async_hooks'
import { costUsd, priceFor, type AiPricing } from './pricing'

// ── Per-request AI metering ──────────────────────────────────────
// Every provider call (Groq, xKiro, Cohere, Gemini, OpenRouter, Gemini vision)
// goes through meterCall(), which times it and records the tokens the provider
// reported. The calls are collected in an AsyncLocalStorage scope opened by
// meteredAiRoute() (src/lib/ai/usage.ts) around a route handler, so one user
// request — however many batches, chunks or fallback attempts it takes — ends
// up as ONE ledger row with the summed tokens and cost.
//
// Outside such a scope (scripts, tests) recording is a no-op: the provider
// call itself behaves exactly as before.

export interface AiCallRecord {
  provider: string
  model: string
  ok: boolean
  /** Undefined when the provider did not report usage (then estimated). */
  inputTokens?: number
  outputTokens?: number
  ms: number
  /** Short failure code: an HTTP status ("429"), "timeout", "empty" or "error". */
  error?: string
  /** Character counts, used only to estimate tokens a provider did not report. */
  promptChars?: number
  outputChars?: number
}

export interface MeterState {
  feature: string
  userId: string | null
  blocked: boolean
  calls: AiCallRecord[]
}

const store = new AsyncLocalStorage<MeterState>()

export function runMetered<T>(state: MeterState, fn: () => Promise<T>): Promise<T> {
  return store.run(state, fn)
}

export function currentMeter(): MeterState | undefined {
  return store.getStore()
}

export function recordAiCall(call: AiCallRecord): void {
  store.getStore()?.calls.push(call)
}

export function aiErrorCode(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && (e as { name: unknown }).name === 'AbortError') return 'timeout'
  const msg = e instanceof Error ? e.message : String(e)
  if (/timed out|timeout/i.test(msg)) return 'timeout'
  const status = msg.match(/\b([45]\d\d)\b/)
  if (status) return status[1]
  if (/no content|empty/i.test(msg)) return 'empty'
  return 'error'
}

export interface MeteredResult<T> {
  value: T
  /** The model that actually answered, when the provider says (OpenRouter routes). */
  model?: string
  inputTokens?: number
  outputTokens?: number
  outputChars?: number
}

/** Times one provider call and records it — success or failure — then
 *  returns (or rethrows) exactly what the call did. */
export async function meterCall<T>(
  provider: string,
  model: string,
  promptChars: number,
  run: () => Promise<MeteredResult<T>>,
): Promise<T> {
  const started = Date.now()
  try {
    const r = await run()
    recordAiCall({
      provider,
      model: r.model || model,
      ok: true,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      ms: Date.now() - started,
      promptChars,
      outputChars: r.outputChars,
    })
    return r.value
  } catch (e) {
    recordAiCall({ provider, model, ok: false, ms: Date.now() - started, error: aiErrorCode(e) })
    throw e
  }
}

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  /** Gemini 2.5 "thinking" tokens — billed as output. */
  thoughtsTokenCount?: number
}

/** Token usage from a Gemini SDK response (`result.response`). */
export function geminiUsage(response: { usageMetadata?: unknown }): { inputTokens?: number; outputTokens?: number } {
  const u = response.usageMetadata as GeminiUsageMetadata | undefined
  if (!u || typeof u.promptTokenCount !== 'number') return {}
  return {
    inputTokens: u.promptTokenCount,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  }
}

/** Arabic runs at roughly 2.5–3 characters per token, English at ~4. Used
 *  only when a provider omits usage; such rows are flagged as estimated. */
export function estimateTokens(chars: number | undefined): number {
  return chars && chars > 0 ? Math.ceil(chars / 3) : 0
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export interface AiUsageSummary {
  provider: string
  model: string | null
  providerCalls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
  estimated: boolean
  listCostUsd: number
  billedCostUsd: number
  latencyMs: number | null
  detail: { calls: Array<Record<string, unknown>> }
}

/** Folds a request's provider calls into one ledger row, priced with `pricing`. */
export function summarizeAiCalls(calls: AiCallRecord[], pricing: AiPricing): AiUsageSummary {
  const billed = new Set(pricing.billedProviders)
  let inputTokens = 0, outputTokens = 0, listCost = 0, billedCost = 0, ms = 0, failed = 0
  let estimated = false

  const detail = calls.map(c => {
    let inTok = c.inputTokens
    let outTok = c.outputTokens
    let est = false
    if (c.ok && (inTok == null || outTok == null)) {
      inTok ??= estimateTokens(c.promptChars)
      outTok ??= estimateTokens(c.outputChars)
      est = true
    }
    inTok ??= 0
    outTok ??= 0

    const price = priceFor(pricing, c.model)
    const cost = price ? costUsd(price, inTok, outTok) : 0

    inputTokens += inTok
    outputTokens += outTok
    listCost += cost
    if (billed.has(c.provider)) billedCost += cost
    ms += c.ms
    if (!c.ok) failed++
    if (est) estimated = true

    return {
      p: c.provider,
      m: c.model,
      ok: c.ok,
      in: inTok,
      out: outTok,
      ms: c.ms,
      cost: round6(cost),
      ...(est ? { est: true } : {}),
      ...(!price && inTok + outTok > 0 ? { np: true } : {}),
      ...(c.error ? { err: c.error } : {}),
    }
  })

  const answered = [...calls].reverse().find(c => c.ok)
  return {
    provider: answered?.provider ?? calls[calls.length - 1]?.provider ?? 'none',
    model: answered?.model ?? null,
    providerCalls: calls.length,
    failedCalls: failed,
    inputTokens,
    outputTokens,
    estimated,
    listCostUsd: round6(listCost),
    billedCostUsd: round6(billedCost),
    latencyMs: calls.length ? ms : null,
    detail: { calls: detail },
  }
}
