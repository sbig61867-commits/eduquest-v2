// Cloudflare Turnstile as a trust signal, never a gate (the widget is
// src/components/shared/turnstile.tsx).
//
// A whole class signs in or joins from one school IP, so the pre-auth routes
// need per-IP limits sized for a classroom, but those are only safe for
// humans. A request whose token Cloudflare accepts gets the classroom-sized
// limit; any other request (no token, a rejected token, Turnstile blocked on
// the network, Cloudflare unreachable, keys not configured) gets the strict
// limit these routes had before Turnstile. Nobody is refused for a missing
// token, and a bot without one is no better off than before.
//
// Supabase Auth's own CAPTCHA switch stays OFF: a token is single-use, so it
// cannot be verified here and again by Supabase.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** The token a form posted as `captchaToken`, or undefined. */
export function captchaTokenFrom(body: unknown): string | undefined {
  const token = (body as { captchaToken?: unknown } | null)?.captchaToken
  return typeof token === 'string' && token.length > 0 && token.length <= 4096 ? token : undefined
}

/**
 * True only when TURNSTILE_SECRET_KEY is set and Cloudflare accepts the
 * token. Every other outcome is false, so the caller falls back to its strict
 * limit; there is no fail-open path.
 */
export async function isVerifiedHuman(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || !token) return false
  const form = new URLSearchParams({ secret, response: token })
  if (ip && ip !== 'unknown') form.set('remoteip', ip)
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5_000) })
    const data = await res.json() as { success?: unknown }
    return data.success === true
  } catch (e) {
    console.error('[captcha] siteverify unreachable; strict limit applies:', e)
    return false
  }
}

/** Per-IP limits of a pre-auth route: `human` after a verified token, `strict` otherwise. */
export interface TieredLimit {
  human: { limit: number; windowSecs: number }
  strict: { limit: number; windowSecs: number }
}

/**
 * The rate-limit key and limit for this request. The two tiers use separate
 * buckets, so requests without a token can never use up the classroom bucket.
 */
export async function ipLimitFor(
  feature: string, ip: string, token: string | undefined, tiers: TieredLimit,
): Promise<{ key: string; limit: number; windowSecs: number }> {
  return (await isVerifiedHuman(token, ip))
    ? { key: `${feature}:ip-human:${ip}`, ...tiers.human }
    : { key: `${feature}:ip:${ip}`, ...tiers.strict }
}
