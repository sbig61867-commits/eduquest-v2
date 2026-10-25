'use client'

import { useEffect } from 'react'
import { signOutAndLeave } from '@/lib/sign-out'

// Polls /api/session/check every 3 min to detect: user disabled/deleted, tenant
// suspended/deleted. When the check fails, signs out immediately instead of
// waiting for the JWT to expire (up to ~1h). Also re-checks on tab focus so
// a user who returns after their tenant was suspended is kicked right away.
//
// Not Realtime because Supabase Realtime enforces RLS on postgres_changes,
// and non-admin users don't have SELECT on the universities row that would
// change. Polling on a server endpoint (service-role) is simpler and honest.
// Every 10 min (was 3; owner 2026-10-25, to stay within the hosting plan's
// request allowance): a disabled account or suspended tenant is signed out
// within 10 minutes, or at once on the next focus after MIN_GAP_MS. Writes do
// not wait for this: the proxy re-checks the live account before every write.
const POLL_INTERVAL_MS = 10 * 60_000
const MIN_GAP_MS = 60_000
// The first check waits until the page has finished loading, so it never
// competes with the page's own requests.
const FIRST_CHECK_DELAY_MS = 4_000

export function TenantWatcher() {
  useEffect(() => {
    let stopped = false

    // Focus and visibility events fire constantly (every alt-tab), so a check
    // is skipped when one ran less than MIN_GAP_MS ago, and the interval does
    // nothing while the tab is hidden. A suspended user is still caught on the
    // first check after they come back.
    let lastCheck = 0

    async function check() {
      if (stopped) return
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastCheck < MIN_GAP_MS) return
      lastCheck = now
      try {
        const res = await fetch('/api/session/check', { cache: 'no-store' })
        if (res.status === 401) return // no session yet — leave it to the proxy
        if (!res.ok) return             // transient error — try again next tick
        const data = await res.json() as { ok: boolean; reason?: string }
        if (!data.ok) {
          stopped = true
          await signOutAndLeave(`/login?reason=${encodeURIComponent(data.reason ?? 'suspended')}`)
        }
      } catch {
        // network blip — swallow and try next tick
      }
    }

    // Once shortly after mount, so a page refresh still kicks a suspended user.
    const first = window.setTimeout(check, FIRST_CHECK_DELAY_MS)
    const id = window.setInterval(check, POLL_INTERVAL_MS)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      stopped = true
      window.clearTimeout(first)
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  return null
}
