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

/** AbortSignal that fires after AI_TIMEOUT_MS — for use with fetch(). */
export function aiTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(AI_TIMEOUT_MS)
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
