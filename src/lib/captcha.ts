// Server side of Cloudflare Turnstile (the widget is
// src/components/shared/turnstile.tsx). Two paths:
//  - Supabase Auth calls (sign-in, reset): Supabase verifies the token itself
//    once its CAPTCHA protection is on; a route only passes on what the form
//    sent.
//  - Account creation through the admin API (accept-invitation) skips that
//    check, so the route verifies with Cloudflare directly (verifyTurnstile).

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** The token a form posted as `captchaToken`, or undefined. */
export function captchaTokenFrom(body: unknown): string | undefined {
  const token = (body as { captchaToken?: unknown } | null)?.captchaToken
  return typeof token === 'string' && token.length > 0 && token.length <= 4096 ? token : undefined
}

/** Supabase Auth refused the call because the CAPTCHA token was missing or rejected. */
export function isCaptchaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === 'captcha_failed' || /captcha/i.test(error.message ?? '')
}

/**
 * Checks a token with Cloudflare. True while TURNSTILE_SECRET_KEY is unset
 * (protection off). A token Cloudflare rejects is false; Cloudflare being
 * unreachable is true, like the rate limiter: a caller cannot cause that
 * outage, and it must not lock a class out of joining.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false
  const form = new URLSearchParams({ secret, response: token })
  if (ip && ip !== 'unknown') form.set('remoteip', ip)
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5_000) })
    const data = await res.json() as { success?: unknown }
    return data.success === true
  } catch (e) {
    console.error('[captcha] siteverify unreachable, letting the request through:', e)
    return true
  }
}
