import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { NextIntlClientProvider } from 'next-intl'

// Cloudflare Turnstile on the auth forms (src/components/shared/turnstile.tsx,
// src/lib/captcha.ts). With no keys set nothing changes; with keys, every
// password check carries a single-use token, and accept-invitation (admin API,
// outside Supabase's own CAPTCHA) verifies it with Cloudflare itself.

// Shared, hoisted doubles for the two pre-auth routes. Re-registering them per
// test (vi.doMock + resetModules) let a stale module win on some runs.
const rl = vi.hoisted(() => ({ allowed: true, calls: [] as { key: string; limit: number }[] }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async (key: string, opts: { limit: number }) => {
    rl.calls.push({ key, limit: opts.limit })
    return { allowed: rl.allowed, resetAt: Date.now() }
  },
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

beforeEach(() => { rl.allowed = true; rl.calls = [] })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('captcha helpers', () => {
  it('reads only a sane string token from the body', async () => {
    const { captchaTokenFrom } = await import('@/lib/captcha')
    expect(captchaTokenFrom({ captchaToken: 'abc' })).toBe('abc')
    expect(captchaTokenFrom({ captchaToken: '' })).toBeUndefined()
    expect(captchaTokenFrom({ captchaToken: 42 })).toBeUndefined()
    expect(captchaTokenFrom({ captchaToken: 'x'.repeat(5000) })).toBeUndefined()
    expect(captchaTokenFrom(null)).toBeUndefined()
  })

  it('recognises Supabase refusing the CAPTCHA, and nothing else', async () => {
    const { isCaptchaError } = await import('@/lib/captcha')
    expect(isCaptchaError({ code: 'captcha_failed', message: '' })).toBe(true)
    expect(isCaptchaError({ message: 'captcha protection: request disallowed (no captcha response)' })).toBe(true)
    expect(isCaptchaError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(false)
    expect(isCaptchaError(null)).toBe(false)
  })

  it('verifyTurnstile: passes everything while no secret is set (protection off)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { verifyTurnstile } = await import('@/lib/captcha')
    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('verifyTurnstile: with a secret, a missing or rejected token fails and an accepted one passes', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as URLSearchParams
      return new Response(JSON.stringify({ success: form.get('response') === 'good' }))
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { verifyTurnstile } = await import('@/lib/captcha')
    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await verifyTurnstile('bad', '1.2.3.4')).toBe(false)
    expect(await verifyTurnstile('good', '1.2.3.4')).toBe(true)
    const form = fetchSpy.mock.calls[1][1].body as URLSearchParams
    expect(form.get('secret')).toBe('secret')
    expect(form.get('remoteip')).toBe('1.2.3.4')
  })

  it('verifyTurnstile: Cloudflare unreachable lets the request through', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { verifyTurnstile } = await import('@/lib/captcha')
    expect(await verifyTurnstile('any', 'unknown')).toBe(true)
  })
})

describe('<Turnstile />', () => {
  type Handle = import('@/components/shared/turnstile').TurnstileHandle
  const wrap = (ui: React.ReactNode) => <NextIntlClientProvider locale="ar" messages={{}}>{ui}</NextIntlClientProvider>

  beforeEach(() => { vi.resetModules(); delete window.turnstile })

  it('renders nothing and hands out no token while no site key is set', async () => {
    const { Turnstile } = await import('@/components/shared/turnstile')
    const ref = createRef<Handle>()
    const { container } = render(wrap(<Turnstile ref={ref} />))
    expect(container.innerHTML).toBe('')
    expect(await ref.current!.take()).toBeUndefined()
  })

  it('hands each token over once and asks for a fresh one', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key')
    let onToken: (t: string) => void = () => {}
    const api = {
      render: vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => { onToken = opts.callback as (t: string) => void; return 'w1' }),
      reset: vi.fn(),
      remove: vi.fn(),
    }
    window.turnstile = api
    const { Turnstile } = await import('@/components/shared/turnstile')
    const ref = createRef<Handle>()
    const { unmount } = render(wrap(<Turnstile ref={ref} />))
    await act(async () => {})
    expect(api.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      sitekey: 'site-key', language: 'ar', appearance: 'interaction-only',
    }))

    act(() => onToken('tok-1'))
    expect(await ref.current!.take()).toBe('tok-1')
    expect(api.reset).toHaveBeenCalledWith('w1')

    // The next submit waits for the widget's next token instead of reusing the spent one.
    let second: string | undefined
    const pending = ref.current!.take().then(t => { second = t })
    await act(async () => {})
    expect(second).toBeUndefined()
    act(() => onToken('tok-2'))
    await pending
    expect(second).toBe('tok-2')

    unmount()
    expect(api.remove).toHaveBeenCalledWith('w1')
  })
})

describe('POST /api/auth/login-id', () => {
  const state = {
    signIn: [] as unknown[],
    signInError: null as null | { code?: string; message: string },
  }

  beforeEach(() => {
    vi.resetModules()
    state.signIn = []; state.signInError = null
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', email: 'QOU-S48203917' } }) }) }) }),
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'u1@no-email.invalid' } } }) } },
      }),
    }))
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: {
          signInWithPassword: async (creds: unknown) => {
            state.signIn.push(creds)
            return state.signInError
              ? { data: { user: null }, error: state.signInError }
              : { data: { user: { app_metadata: { user_role: 'student' } } }, error: null }
          },
        },
      }),
    }))
  })

  const call = async (body: unknown) => {
    const { POST } = await import('@/app/api/auth/login-id/route')
    return POST(new Request('http://x/api/auth/login-id', {
      method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify(body),
    }))
  }

  it('keeps the per-ID limit tight and lets a whole class share one school IP', async () => {
    await call({ code: 'QOU-S48203917', password: 'pw' })
    expect(rl.calls).toEqual([
      { key: 'login-id:code:QOU-S48203917', limit: 10 },
      { key: 'login-id:ip:9.9.9.9', limit: 120 },
    ])
  })

  it('passes the form\'s Turnstile token on to Supabase', async () => {
    const res = await call({ code: 'QOU-S48203917', password: 'pw', captchaToken: 'tok-1' })
    expect(res.status).toBe(200)
    expect(state.signIn).toEqual([{ email: 'u1@no-email.invalid', password: 'pw', options: { captchaToken: 'tok-1' } }])
  })

  it('reports a refused CAPTCHA as such, not as a wrong password', async () => {
    state.signInError = { code: 'captcha_failed', message: 'captcha protection: request disallowed' }
    const res = await call({ code: 'QOU-S48203917', password: 'pw', captchaToken: 'stale' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('captchaFailed')
  })

  it('still answers a wrong password with the generic login error', async () => {
    state.signInError = { code: 'invalid_credentials', message: 'Invalid login credentials' }
    const res = await call({ code: 'QOU-S48203917', password: 'nope' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('invalidLogin')
  })
})

describe('POST /api/auth/accept-invitation', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('refuses before touching the database when Cloudflare rejects the token', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))))
    const createClient = vi.fn()
    vi.doMock('@supabase/supabase-js', () => ({ createClient }))
    const { POST } = await import('@/app/api/auth/accept-invitation/route')
    const res = await POST(new Request('http://x/api/auth/accept-invitation', {
      method: 'POST',
      body: JSON.stringify({ token: 'inv', email: 'a@b.test', password: 'password1', fullName: 'A', captchaToken: 'bot' }),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('captchaFailed')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('allows a class-sized burst from one IP', async () => {
    rl.allowed = false
    const { POST } = await import('@/app/api/auth/accept-invitation/route')
    await POST(new Request('http://x/api/auth/accept-invitation', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: '{}' }))
    expect(rl.calls).toEqual([{ key: 'accept-invitation:9.9.9.9', limit: 60 }])
  })
})
