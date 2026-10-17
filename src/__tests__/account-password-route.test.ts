import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/account/password — the settings page's "change password" for every
// role. It must require the current password, change only the caller's own
// password, never sign the caller out, and be rate limited.

const state = vi.hoisted(() => ({
  user: { id: 'u1', email: 'owner@example.test' } as { id: string; email?: string } | null,
  realPassword: 'old-password',
  rateAllowed: true,
  updateError: null as null | { message: string },
  calls: { signIn: [] as { email: string; password: string }[], signOut: [] as unknown[], update: [] as unknown[], rate: [] as string[] },
}))

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async (key: string) => { state.calls.rate.push(key); return { allowed: state.rateAllowed } },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async (creds: { email: string; password: string }) => {
        state.calls.signIn.push(creds)
        return creds.password === state.realPassword
          ? { data: { user: { id: state.user?.id } }, error: null }
          : { data: { user: null }, error: { message: 'Invalid login credentials' } }
      },
      signOut: async (opts: unknown) => { state.calls.signOut.push(opts); return { error: null } },
      admin: {
        updateUserById: async (id: string, attrs: unknown) => { state.calls.update.push({ id, attrs }); return { error: state.updateError } },
      },
    },
  }),
}))

const { POST } = await import('@/app/api/account/password/route')
const call = (body: unknown) => POST(new Request('http://x/api/account/password', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  state.user = { id: 'u1', email: 'owner@example.test' }
  state.rateAllowed = true
  state.updateError = null
  state.calls = { signIn: [], signOut: [], update: [], rate: [] }
})

describe('POST /api/account/password', () => {
  it('changes the password when the current one is right', async () => {
    const res = await call({ current: 'old-password', next: 'brand-new-pass' })
    expect(res.status).toBe(200)
    expect(state.calls.update).toEqual([{ id: 'u1', attrs: { password: 'brand-new-pass' } }])
  })

  it('checks the current password against the caller\'s own auth email', async () => {
    await call({ current: 'old-password', next: 'brand-new-pass' })
    expect(state.calls.signIn).toEqual([{ email: 'owner@example.test', password: 'old-password' }])
  })

  it('signs out only the throwaway check session, never the caller', async () => {
    await call({ current: 'old-password', next: 'brand-new-pass' })
    expect(state.calls.signOut).toEqual([{ scope: 'local' }])
  })

  it('refuses a wrong current password and changes nothing', async () => {
    const res = await call({ current: 'guess', next: 'brand-new-pass' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('currentPasswordWrong')
    expect(state.calls.update).toEqual([])
  })

  it('refuses a missing current password without trying to sign in', async () => {
    const res = await call({ next: 'brand-new-pass' })
    expect((await res.json()).code).toBe('currentPasswordWrong')
    expect(state.calls.signIn).toEqual([])
  })

  it('refuses a short new password', async () => {
    const res = await call({ current: 'old-password', next: 'short' })
    expect((await res.json()).code).toBe('passwordTooShort')
    expect(state.calls.update).toEqual([])
  })

  it('refuses a new password equal to the current one', async () => {
    const res = await call({ current: 'old-password', next: 'old-password' })
    expect((await res.json()).code).toBe('passwordSameAsCurrent')
    expect(state.calls.update).toEqual([])
  })

  it('requires a signed-in user', async () => {
    state.user = null
    const res = await call({ current: 'old-password', next: 'brand-new-pass' })
    expect(res.status).toBe(401)
    expect(state.calls.signIn).toEqual([])
  })

  it('is rate limited per user, before any password check', async () => {
    state.rateAllowed = false
    const res = await call({ current: 'old-password', next: 'brand-new-pass' })
    expect(res.status).toBe(429)
    expect(state.calls.rate).toEqual(['account-password:u1'])
    expect(state.calls.signIn).toEqual([])
  })

  it('reports a failed write without leaking the provider message', async () => {
    state.updateError = { message: 'internal detail' }
    const res = await call({ current: 'old-password', next: 'brand-new-pass' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'passwordChangeFailed', code: 'passwordChangeFailed' })
  })
})
