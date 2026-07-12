// Server-side base-URL resolution for auth emails (password reset, etc.).
// Never trust NEXT_PUBLIC_APP_URL blindly: if it's stale, localhost-in-prod,
// or missing, fall back to the validated request origin — and never allow an
// external domain to end up in a Supabase redirectTo.

const PROD_URL = 'https://eduquest-v2.vercel.app'
const TRUSTED_ORIGINS = new Set([PROD_URL])
const LOCALHOST_RE = /^http:\/\/localhost(:\d+)?$/

/**
 * Resolve the app base URL (no trailing slash) in strict priority order:
 * 1. NEXT_PUBLIC_APP_URL — only if it is a trusted production origin
 * 2. the current request's origin — only if trusted production or localhost
 * 3. the hardcoded production URL (never an external domain)
 */
export function resolveAppUrl(requestUrl: string, envAppUrl?: string): string {
  const env = (envAppUrl ?? '').replace(/\/$/, '')
  if (TRUSTED_ORIGINS.has(env)) return env

  let origin = ''
  try {
    origin = new URL(requestUrl).origin
  } catch {
    /* fall through to PROD_URL */
  }
  if (TRUSTED_ORIGINS.has(origin) || LOCALHOST_RE.test(origin)) return origin

  // Everything else — stale env (e.g. localhost on production), preview
  // domain, attacker-controlled Host header — resolves to production.
  return PROD_URL
}

/** Full redirectTo for resetPasswordForEmail. */
export function resetPasswordRedirectTo(requestUrl: string, envAppUrl?: string): string {
  return `${resolveAppUrl(requestUrl, envAppUrl)}/auth/callback?next=/reset-password`
}
