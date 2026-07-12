/**
 * Password reset flow tests.
 *
 * Covers:
 *  1. Valid email → 200 + generic message (does not reveal whether email exists)
 *  2. Unknown email → same 200 + same generic message (no enumeration)
 *  3. Missing / malformed email → 400
 *  4. Network / rate-limit failure → safe response
 *  5. Password mismatch validation (pure logic, no DOM)
 *  6. Password too short validation
 *  7. Successful password update (updateUser called)
 *  8. open-redirect: next param with //evil.com blocked by callback
 */
import { describe, it, expect } from 'vitest'
import { resolveAppUrl, resetPasswordRedirectTo } from '@/lib/auth-urls'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SENT_MSG = 'If that email is registered, you will receive a reset link shortly.'

// Simulate the API route logic in isolation
async function callForgotPasswordRoute(
  email: string | undefined,
  opts: { rateLimitAllowed?: boolean; resetError?: string | null } = {}
) {
  const { rateLimitAllowed = true, resetError = null } = opts

  // Validate email (mirrors the route)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 400, body: { error: 'Valid email required' } }
  }

  // Rate limit check (mocked)
  if (!rateLimitAllowed) {
    return { status: 200, body: { message: SENT_MSG } }
  }

  // Supabase call (mocked) — always returns generic message
  if (resetError) {
    // Even if Supabase errors, we still return the generic message (no enumeration)
    return { status: 200, body: { message: SENT_MSG } }
  }

  return { status: 200, body: { message: SENT_MSG } }
}

// Simulate client-side password validation (mirrors the form)
function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (password !== confirm) return 'Passwords do not match.'
  return null
}

// Simulate callback next-param sanitisation (mirrors the route)
function sanitiseNext(raw: string | null): string {
  if (!raw) return '/'
  return /^\/[^/\\]/.test(raw) ? raw : '/'
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('forgot-password API route', () => {
  it('1. valid email → 200 with generic message', async () => {
    const res = await callForgotPasswordRoute('user@university.edu')
    expect(res.status).toBe(200)
    expect(res.body.message).toBe(SENT_MSG)
  })

  it('2. unknown email → same 200 + same generic message (no enumeration)', async () => {
    // Supabase is a no-op for unknown emails, our route always returns the same message
    const res = await callForgotPasswordRoute('nobody@nowhere.invalid')
    expect(res.status).toBe(200)
    expect(res.body.message).toBe(SENT_MSG)
    // Must not reveal whether the email was found
    expect(JSON.stringify(res.body)).not.toContain('not found')
    expect(JSON.stringify(res.body)).not.toContain('does not exist')
  })

  it('3. missing email → 400', async () => {
    const res = await callForgotPasswordRoute(undefined)
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('3b. malformed email → 400', async () => {
    const res = await callForgotPasswordRoute('not-an-email')
    expect(res.status).toBe(400)
  })

  it('4. rate-limited → still returns generic 200 (no info leak about limit)', async () => {
    const res = await callForgotPasswordRoute('user@university.edu', { rateLimitAllowed: false })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe(SENT_MSG)
  })

  it('4b. Supabase internal error → still returns generic 200', async () => {
    const res = await callForgotPasswordRoute('user@university.edu', { resetError: 'network error' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe(SENT_MSG)
  })
})

describe('reset-password form validation', () => {
  it('5. password mismatch → error message', () => {
    const err = validateNewPassword('strongpass', 'different!')
    expect(err).toBe('Passwords do not match.')
  })

  it('6. password too short → error message', () => {
    const err = validateNewPassword('short', 'short')
    expect(err).toMatch(/at least 8/)
  })

  it('7. valid passwords → no error', () => {
    const err = validateNewPassword('strongpass!', 'strongpass!')
    expect(err).toBeNull()
  })

  it('7b. exactly 8 characters → valid', () => {
    const err = validateNewPassword('12345678', '12345678')
    expect(err).toBeNull()
  })

  it('7c. 7 characters → invalid', () => {
    const err = validateNewPassword('1234567', '1234567')
    expect(err).not.toBeNull()
  })
})

// Simulate the submit flow of the reset-password page (mirrors handleSubmit)
async function runResetSubmit(deps: {
  updateUser: () => Promise<{ error: { message: string } | null }>
  signOut: (opts?: { scope?: string }) => Promise<{ error: { message: string } | null }>
}) {
  const result = { signOutCalledWith: undefined as undefined | { scope?: string }, redirected: false, error: '' }

  const { error: updateErr } = await deps.updateUser()
  if (updateErr) {
    result.error = updateErr.message
    return result
  }

  const signOut = async (opts?: { scope?: string }) => {
    result.signOutCalledWith = opts
    return deps.signOut(opts)
  }
  const { error: signOutErr } = await signOut({ scope: 'global' })
  if (signOutErr) {
    result.error = 'Your password was changed, but signing out failed.'
    return result
  }

  result.redirected = true
  return result
}

describe('reset-password submit flow', () => {
  const ok = async () => ({ error: null })

  it('9. updateUser succeeds → signOut called with scope global', async () => {
    const r = await runResetSubmit({ updateUser: ok, signOut: ok })
    expect(r.signOutCalledWith).toEqual({ scope: 'global' })
  })

  it('10. successful flow → redirect to login happens', async () => {
    const r = await runResetSubmit({ updateUser: ok, signOut: ok })
    expect(r.redirected).toBe(true)
    expect(r.error).toBe('')
  })

  it('11. updateUser fails → NO signOut and NO redirect', async () => {
    const r = await runResetSubmit({
      updateUser: async () => ({ error: { message: 'weak password' } }),
      signOut: ok,
    })
    expect(r.signOutCalledWith).toBeUndefined()
    expect(r.redirected).toBe(false)
    expect(r.error).toBe('weak password')
  })

  it('12. signOut fails after password change → error shown, no redirect', async () => {
    const r = await runResetSubmit({
      updateUser: ok,
      signOut: async () => ({ error: { message: 'network' } }),
    })
    expect(r.redirected).toBe(false)
    expect(r.error).toMatch(/password was changed/)
  })
})

describe('resetPasswordForEmail redirectTo (real src/lib/auth-urls.ts)', () => {
  const PROD = 'https://eduquest-v2.vercel.app'

  it('13. production env → full redirectTo with /auth/callback?next=/reset-password', () => {
    expect(resetPasswordRedirectTo(`${PROD}/api/auth/forgot-password`, PROD))
      .toBe(`${PROD}/auth/callback?next=/reset-password`)
  })

  it('13b. trailing slash in env is stripped', () => {
    expect(resetPasswordRedirectTo(`${PROD}/api/auth/forgot-password`, `${PROD}/`))
      .toBe(`${PROD}/auth/callback?next=/reset-password`)
  })

  it('14. localhost request with no env → localhost redirectTo', () => {
    expect(resetPasswordRedirectTo('http://localhost:3000/api/auth/forgot-password', undefined))
      .toBe('http://localhost:3000/auth/callback?next=/reset-password')
  })

  it('15. stale localhost env on a production request → production URL wins', () => {
    expect(resolveAppUrl(`${PROD}/api/auth/forgot-password`, 'http://localhost:3000'))
      .toBe(PROD)
  })

  it('16. external/attacker origin and env → forced to production, never external', () => {
    expect(resolveAppUrl('https://evil.com/api/auth/forgot-password', 'https://evil.com')).toBe(PROD)
    expect(resolveAppUrl('not-a-url', 'https://evil.com')).toBe(PROD)
  })

  it('16b. vercel preview origin → forced to production (not in allow list)', () => {
    expect(resolveAppUrl('https://eduquest-v2-abc123.vercel.app/api/x', undefined)).toBe(PROD)
  })
})

describe('auth callback — open redirect prevention', () => {
  it('8a. absolute URL in next param → sanitised to /', () => {
    expect(sanitiseNext('https://evil.com')).toBe('/')
  })

  it('8b. protocol-relative URL → sanitised to /', () => {
    expect(sanitiseNext('//evil.com')).toBe('/')
  })

  it('8c. backslash escape → sanitised to /', () => {
    expect(sanitiseNext('/\\evil.com')).toBe('/')
  })

  it('8d. valid relative path → kept', () => {
    expect(sanitiseNext('/reset-password')).toBe('/reset-password')
  })

  it('8e. null next → defaults to /', () => {
    expect(sanitiseNext(null)).toBe('/')
  })
})
