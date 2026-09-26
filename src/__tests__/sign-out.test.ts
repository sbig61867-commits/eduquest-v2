import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const localSignOut = vi.fn()
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: localSignOut } }) }))

// Route dependencies
const serverSignOut = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signOut: serverSignOut } }) }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [
      { name: 'sb-abc-auth-token.0', value: 'x' },
      { name: 'sb-abc-auth-token.1', value: 'y' },
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
    localSignOut.mockReset().mockResolvedValue({ error: null })
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
    localSignOut.mockRejectedValue(new Error('offline'))
    await signOutAndLeave('/login?reason=user_disabled')
    expect(replace).toHaveBeenCalledWith('/login?reason=user_disabled')
  })

  it('never hangs on a stuck request', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    localSignOut.mockImplementation(() => new Promise(() => {}))
    const done = signOutAndLeave()
    await vi.advanceTimersByTimeAsync(7000)
    await done
    expect(replace).toHaveBeenCalledWith('/login')
  })
})

describe('POST /auth/signout', () => {
  it('deletes every Supabase auth cookie even when the revoke call fails', async () => {
    serverSignOut.mockRejectedValue(new Error('network'))
    const res = await POST()
    const cleared = res.cookies.getAll().filter(c => c.value === '').map(c => c.name).sort()
    expect(cleared).toEqual(['sb-abc-auth-token.0', 'sb-abc-auth-token.1'])
    expect(res.cookies.get('eq_locale')).toBeUndefined() // the language preference survives
  })
})
