'use client'

import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'

function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>(resolve => setTimeout(resolve, ms))])
}

/**
 * Sign out and leave the app with a FULL page load.
 *
 * 1. /auth/signout revokes the session and deletes the auth cookies server-side
 *    (works even when the logout network call is slow or fails).
 * 2. The browser client drops its in-memory session (bounded — never hangs).
 * 3. The persisted account store is cleared, so the next person on this
 *    device never sees the previous name for a frame.
 * 4. window.location.replace — not router.push: a client-side navigation keeps
 *    the router cache and every mounted component of the signed-in app, which
 *    is what left the old account on screen until a manual refresh.
 */
export async function signOutAndLeave(target = '/login'): Promise<void> {
  try {
    await within(fetch('/auth/signout', { method: 'POST', cache: 'no-store' }), 5000)
  } catch { /* offline — the local steps below still run */ }
  try {
    await within(createClient().auth.signOut({ scope: 'local' }), 1500)
  } catch { /* ignore */ }
  useAuthStore.getState().reset()
  window.location.replace(target)
}
