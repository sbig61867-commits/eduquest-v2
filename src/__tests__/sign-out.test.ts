import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Route dependencies: the Better Auth revoke, and the cookies of the request
const serverSignOut = vi.fn()
vi.mock('@/lib/auth/better', () => ({ authSignOut: (...a: unknown[]) => serverSignOut(...a) }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    getAll: () => [
      { name: 'tm.session_token', value: 'x' },
      { name: '__Secure-tm.session_data', value: 'y' },
      { name: 'tm_ctx', value: 'z' },
      { name: 'eq_locale', value: 'ar' },
    ],
  }),
}))

import { signOutAndLeave } from '@/lib/sign-out'
import { POST } from '@/app/auth/signout/route'
import { useAuthStore } from '@/stores/auth-store'

describe('signOutAndLeave', () => {
  const replace = vi.fn()
  beforeEach(() => {
    replace.mockReset()
    vi.stubGlobal('location', { ...window.location, replace })
    useAuthStore.setState({ user: { id: 'u1' } as never, tenant: { id: 't1' } as never })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('clears the session server-side, resets the store and reloads to /login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await signOutAndLeave()
    expect(fetchMock).toHaveBeenCalledWith('/auth/signout', expect.objectContaining({ method: 'POST' }))
    expect(useAuthStore.getState().user).toBeNull()
    expect(replace).toHaveBeenCalledWith('/login')
  })

  it('still leaves when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await signOutAndLeave('/login?reason=user_disabled')
    expect(replace).toHaveBeenCalledWith('/login?reason=user_disabled')
  })

  it('never hangs on a stuck request', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const done = signOutAndLeave()
    await vi.advanceTimersByTimeAsync(7000)
    await done
    expect(replace).toHaveBeenCalledWith('/login')
  })
})

describe('POST /auth/signout', () => {
  it('deletes every session cookie even when the revoke call fails', async () => {
    serverSignOut.mockRejectedValue(new Error('network'))
    const res = await POST()
    const cleared = res.cookies.getAll().filter(c => c.value === '').map(c => c.name).sort()
    expect(cleared).toEqual(['__Secure-tm.session_data', 'tm.session_token', 'tm_ctx'])
    expect(res.cookies.get('eq_locale')).toBeUndefined() // the language preference survives
  })
})
