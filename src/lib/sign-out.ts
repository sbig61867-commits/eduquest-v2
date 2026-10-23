'use client'

import { useAuthStore } from '@/stores/auth-store'
import { INTRO_DONE_KEY } from '@/lib/brand-intro-key'

function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>(resolve => setTimeout(resolve, ms))])
}

/**
 * Sign out and leave the app with a FULL page load.
 *
 * 1. /auth/signout revokes the session and deletes the auth cookies server-side
 *    (works even when the logout network call is slow or fails). The session
 *    lives only in HttpOnly cookies, so nothing else is held in the browser.
 * 2. The persisted account store is cleared, so the next person on this
 *    device never sees the previous name for a frame.
 * 3. window.location.replace — not router.push: a client-side navigation keeps
 *    the router cache and every mounted component of the signed-in app, which
 *    is what left the old account on screen until a manual refresh.
 */
export async function signOutAndLeave(target = '/login'): Promise<void> {
  try {
    await within(fetch('/auth/signout', { method: 'POST', cache: 'no-store' }), 5000)
  } catch { /* offline — the local steps below still run */ }
  useAuthStore.getState().reset()
  // The next sign-in on this device plays the logo intro again.
  try { localStorage.removeItem(INTRO_DONE_KEY) } catch { /* ignore */ }
  window.location.replace(target)
}
