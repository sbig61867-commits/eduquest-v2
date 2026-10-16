// Shared timeout for all outbound AI-provider calls (Groq fetch, Gemini SDK).
// Prevents a hung provider from holding a serverless function invocation
// open indefinitely — without this, only Vercel's platform-level function
// timeout would eventually kill the request, well after the user has given
// up and possibly retried, compounding load on the provider.
const DEFAULT_AI_TIMEOUT_MS = 25_000

export const AI_TIMEOUT_MS = (() => {
  const raw = process.env.AI_REQUEST_TIMEOUT_MS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_TIMEOUT_MS
})()

/** AbortSignal that fires after `timeoutMs` (default AI_TIMEOUT_MS) — for use with fetch(). */
export function aiTimeoutSignal(timeoutMs: number = AI_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs)
}

/**
 * Timeout for ONE provider call: AI_TIMEOUT_MS, cut down to what is left of
 * `deadline` (absolute epoch ms) so a call started near the end of a request's
 * budget cannot run past it. At least 1 ms.
 */
export function callTimeoutMs(deadline?: number, now: number = Date.now()): number {
  if (deadline === undefined) return AI_TIMEOUT_MS
  return Math.max(1, Math.min(AI_TIMEOUT_MS, deadline - now))
}

/**
 * True when `err` was thrown by an aborted fetch/AbortSignal.timeout().
 * Deliberately does NOT require `err instanceof Error` — a real timeout
 * abort throws a `DOMException` (name: 'AbortError'), and `DOMException`
 * is not a subclass of `Error` in Node/browsers, so an `instanceof Error`
 * check silently fails to recognize the exact case this exists to catch.
 */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && (err as { name: unknown }).name === 'AbortError'
}
