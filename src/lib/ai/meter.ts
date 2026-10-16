import { AsyncLocalStorage } from 'node:async_hooks'
import { costUsd, priceFor, type AiPricing } from './pricing'
import { assertProviderApproved } from './privacy'

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
  /** Quota reservation of this request (AI_QUOTA_RESERVATIONS=on), closed when it ends. */
  holdId?: string
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

/** A provider failure that carries only the provider name and a short code.
 *  Provider bodies and SDK messages can echo prompt text or document content,
 *  so they are never put in an error that may reach a log, Sentry or a response. */
export class AiProviderError extends Error {
  constructor(public provider: string, public code: string) {
    super(`${provider} provider error ${code}`)
    this.name = 'AiProviderError'
  }
}

/** Maps an error thrown by the Gemini SDK to an AiProviderError. The SDK puts
 *  Google's error text (which can quote the request) into its message, so only
 *  the HTTP status or the abort is kept. */
export function geminiProviderError(e: unknown): AiProviderError {
  if (e instanceof AiProviderError) return e
  const status = typeof e === 'object' && e !== null && 'status' in e ? (e as { status?: unknown }).status : undefined
  if (typeof status === 'number') return new AiProviderError('gemini', String(status))
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : ''
  if (/abort/i.test(name)) return new AiProviderError('gemini', 'timeout')
  return new AiProviderError('gemini', 'error')
}

export function aiErrorCode(e: unknown): string {
  if (e instanceof AiProviderError) return e.code
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

/** Logs an AI failure as a category only. Provider and SDK messages can echo
 *  prompt text or partial documents, so they are never written to logs. */
export function logAiFailure(tag: string, e: unknown): void {
  const name = e instanceof Error ? e.name : typeof e
  console.error(tag, { code: aiErrorCode(e), name })
}

/** Times one provider call and records it — success or failure — then
 *  returns (or rethrows) exactly what the call did.
 *
 *  `audiences` is required: the kinds of content in the prompt (privacy.ts).
 *  A missing, empty, unknown or unapproved audience throws PrivacyPendingError
 *  BEFORE `run` starts, so no request leaves the server and nothing is recorded. */
export async function meterCall<T>(
  provider: string,
  model: string,
  promptChars: number,
  audiences: readonly string[],
  run: () => Promise<MeteredResult<T>>,
): Promise<T> {
  assertProviderApproved(provider, audiences)
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
