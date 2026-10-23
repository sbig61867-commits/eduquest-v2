import { authRequestPasswordReset } from '@/lib/auth/better'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { captchaTokenFrom, ipLimitFor, type TieredLimit } from '@/lib/captcha'

// Per IP: a ceiling on bulk enumeration. A verified Turnstile token earns a
// class-sized bucket; without one the pre-Turnstile limit applies
// (src/lib/captcha.ts). The per-email limit below guards each inbox.
const IP_LIMITS: TieredLimit = {
  human: { limit: 30, windowSecs: 3600 },
  strict: { limit: 5, windowSecs: 3600 },
}

// Generic message — identical whether email exists or not (prevents enumeration)
const SENT_MSG = 'If that email is registered, you will receive a reset link shortly.'

export async function POST(request: Request) {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  let email: string
  let captchaToken: string | undefined
  try {
    const body = await request.json()
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    captchaToken = captchaTokenFrom(body)
  } catch {
    return NextResponse.json({ ...(await apiErr('badRequest')) }, { status: 400 })
  }

  const { key, ...ipTier } = await ipLimitFor('forgot-password', ip, captchaToken, IP_LIMITS)
  const ipLimit = await rateLimit(key, ipTier)
  if (!ipLimit.allowed) {
    return NextResponse.json({ message: SENT_MSG }, { status: 200 })
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ...(await apiErr('invalidEmail')) }, { status: 400 })
  }

  // Rate limit by email — 3 attempts per hour prevents email spam to one address
  const emailLimit = await rateLimit(`forgot-password:email:${email}`, { limit: 3, windowSecs: 3600 })
  if (!emailLimit.allowed) {
    return NextResponse.json({ message: SENT_MSG }, { status: 200 })
  }

  // Better Auth sends nothing for an unknown email and says so to no one; the
  // answer is the same either way. The email links to /reset-password on our
  // own domain, in the language of the page the reset was requested from.
  await authRequestPasswordReset(email, request.headers)

  return NextResponse.json({ message: SENT_MSG }, { status: 200 })
}
