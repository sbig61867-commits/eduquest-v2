import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { NextIntlClientProvider } from 'next-intl'

// Cloudflare Turnstile as a trust signal, never a gate (src/lib/captcha.ts,
// src/components/shared/turnstile.tsx). A token Cloudflare accepts earns a
// classroom-sized per-IP limit; every other request gets the strict limit the
// route had before Turnstile, and is never refused for the missing token.

// Shared, hoisted doubles. Re-registering them per test (vi.doMock after a
// module reset) let a stale module win on some runs.
const rl = vi.hoisted(() => ({ allowed: true, calls: [] as { key: string; limit: number }[] }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async (key: string, opts: { limit: number }) => {
    rl.calls.push({ key, limit: opts.limit })
    return { allowed: rl.allowed, resetAt: Date.now() }
  },
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

/** Cloudflare siteverify double: only the token 'good' passes. */
function stubSiteverify() {
  const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
    const form = init.body as URLSearchParams
    return new Response(JSON.stringify({ success: form.get('response') === 'good' }))
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

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

  it('isVerifiedHuman: false while no secret is set, without calling Cloudflare', async () => {
    const fetchSpy = stubSiteverify()
    const { isVerifiedHuman } = await import('@/lib/captcha')
    expect(await isVerifiedHuman('good', '1.2.3.4')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('isVerifiedHuman: only a token Cloudflare accepts is true', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    const fetchSpy = stubSiteverify()
    const { isVerifiedHuman } = await import('@/lib/captcha')
    expect(await isVerifiedHuman(undefined, '1.2.3.4')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await isVerifiedHuman('bad', '1.2.3.4')).toBe(false)
    expect(await isVerifiedHuman('good', '1.2.3.4')).toBe(true)
    const form = fetchSpy.mock.calls[1][1].body as URLSearchParams
    expect(form.get('secret')).toBe('secret')
    expect(form.get('remoteip')).toBe('1.2.3.4')
  })

  it('isVerifiedHuman: Cloudflare unreachable is false (strict limit), never a free pass', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { isVerifiedHuman } = await import('@/lib/captcha')
    expect(await isVerifiedHuman('good', '1.2.3.4')).toBe(false)
  })

  it('ipLimitFor: separate buckets, so token-less requests cannot drain the classroom one', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    stubSiteverify()
    const { ipLimitFor } = await import('@/lib/captcha')
    const tiers = { human: { limit: 60, windowSecs: 3600 }, strict: { limit: 5, windowSecs: 3600 } }
    expect(await ipLimitFor('f', '9.9.9.9', 'good', tiers)).toEqual({ key: 'f:ip-human:9.9.9.9', limit: 60, windowSecs: 3600 })
    expect(await ipLimitFor('f', '9.9.9.9', undefined, tiers)).toEqual({ key: 'f:ip:9.9.9.9', limit: 5, windowSecs: 3600 })
  })
})

describe('<Turnstile />', () => {
  type Handle = import('@/components/shared/turnstile').TurnstileHandle
  const wrap = (ui: React.ReactNode) => <NextIntlClientProvider locale="ar" messages={{}}>{ui}</NextIntlClientProvider>

  beforeEach(() => { vi.resetModules(); delete window.turnstile })

  it('stays off with a site key but without NEXT_PUBLIC_TURNSTILE=on', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key')
    window.turnstile = { render: vi.fn(() => 'w1'), reset: vi.fn(), remove: vi.fn() }
    const { Turnstile } = await import('@/components/shared/turnstile')
    const ref = createRef<Handle>()
    const { container } = render(wrap(<Turnstile ref={ref} />))
    expect(container.innerHTML).toBe('')
    expect(window.turnstile.render).not.toHaveBeenCalled()
    expect(await ref.current!.take()).toBeUndefined()
  })

  it('renders nothing and hands out no token while no site key is set', async () => {
    const { Turnstile } = await import('@/components/shared/turnstile')
    const ref = createRef<Handle>()
    const { container } = render(wrap(<Turnstile ref={ref} />))
    expect(container.innerHTML).toBe('')
    expect(await ref.current!.take()).toBeUndefined()
  })

  it('hands each token over once and asks for a fresh one', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE', 'on'); vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key')
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

  it('a token that never arrives does not hold the submit for long', async () => {
    vi.useFakeTimers()
    try {
      vi.stubEnv('NEXT_PUBLIC_TURNSTILE', 'on'); vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key')
      window.turnstile = { render: vi.fn(() => 'w1'), reset: vi.fn(), remove: vi.fn() }
      const { Turnstile } = await import('@/components/shared/turnstile')
      const ref = createRef<Handle>()
      render(wrap(<Turnstile ref={ref} />))
      await act(async () => {})
      let done = false
      const pending = ref.current!.take().then(t => { done = true; return t })
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      expect(done).toBe(true)
      expect(await pending).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
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

  it('without a verified token: the per-ID limit and the strict per-IP limit, and the sign-in still happens', async () => {
    const res = await call({ code: 'QOU-S48203917', password: 'pw' })
    expect(res.status).toBe(200)
    expect(rl.calls).toEqual([
      { key: 'login-id:code:QOU-S48203917', limit: 10 },
      { key: 'login-id:ip:9.9.9.9', limit: 10 },
    ])
  })

  it('with a verified token: the classroom-sized per-IP bucket; the per-ID limit is unchanged', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    stubSiteverify()
    const res = await call({ code: 'QOU-S48203917', password: 'pw', captchaToken: 'good' })
    expect(res.status).toBe(200)
    expect(rl.calls).toEqual([
      { key: 'login-id:code:QOU-S48203917', limit: 10 },
      { key: 'login-id:ip-human:9.9.9.9', limit: 120 },
    ])
  })

  it('a rejected token falls back to the strict bucket instead of failing the sign-in', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    stubSiteverify()
    const res = await call({ code: 'QOU-S48203917', password: 'pw', captchaToken: 'forged' })
    expect(res.status).toBe(200)
    expect(rl.calls[1]).toEqual({ key: 'login-id:ip:9.9.9.9', limit: 10 })
  })

  it('never forwards the token to Supabase (its own CAPTCHA stays off)', async () => {
    await call({ code: 'QOU-S48203917', password: 'pw', captchaToken: 'good' })
    expect(state.signIn).toEqual([{ email: 'u1@no-email.invalid', password: 'pw' }])
  })

  it('a wrong password is still the generic login error', async () => {
    state.signInError = { code: 'invalid_credentials', message: 'Invalid login credentials' }
    const res = await call({ code: 'QOU-S48203917', password: 'nope' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('invalidLogin')
  })
})

describe('POST /api/auth/accept-invitation', () => {
  beforeEach(() => { vi.resetModules() })

  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/auth/accept-invitation/route')
    return POST(new Request('http://x/api/auth/accept-invitation', {
      method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify(body),
    }))
  }

  it('without a token: the strict limit, and the request is not refused for it', async () => {
    rl.allowed = false
    const res = await post({ token: 'inv', email: 'a@b.test', password: 'password1', fullName: 'A' })
    expect(rl.calls).toEqual([{ key: 'accept-invitation:ip:9.9.9.9', limit: 5 }])
    expect((await res.json()).code).toBe('tooManyRequests')
  })

  it('with a verified token: the classroom-sized bucket', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    stubSiteverify()
    rl.allowed = false
    await post({ token: 'inv', email: 'a@b.test', password: 'password1', fullName: 'A', captchaToken: 'good' })
    expect(rl.calls).toEqual([{ key: 'accept-invitation:ip-human:9.9.9.9', limit: 60 }])
  })
})

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => { vi.resetModules() })

  it('strict per-IP limit without a verified token, class-sized with one', async () => {
    rl.allowed = false
    const { POST } = await import('@/app/api/auth/forgot-password/route')
    const req = (body: unknown) => new Request('http://x/api/auth/forgot-password', {
      method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify(body),
    })
    await POST(req({ email: 'a@b.test' }))
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    stubSiteverify()
    await POST(req({ email: 'a@b.test', captchaToken: 'good' }))
    expect(rl.calls).toEqual([
      { key: 'forgot-password:ip:9.9.9.9', limit: 5 },
      { key: 'forgot-password:ip-human:9.9.9.9', limit: 30 },
    ])
  })
})
