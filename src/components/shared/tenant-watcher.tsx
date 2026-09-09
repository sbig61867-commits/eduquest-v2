'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Polls /api/session/check every 60s to detect: user disabled/deleted, tenant
// suspended/deleted. When the check fails, signs out immediately instead of
// waiting for the JWT to expire (up to ~1h). Also re-checks on tab focus so
// a user who returns after their tenant was suspended is kicked right away.
//
// Not Realtime because Supabase Realtime enforces RLS on postgres_changes,
// and non-admin users don't have SELECT on the universities row that would
// change. Polling on a server endpoint (service-role) is simpler and honest.
const POLL_INTERVAL_MS = 60_000

export function TenantWatcher() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    let stopped = false

    async function check() {
      if (stopped) return
      try {
        const res = await fetch('/api/session/check', { cache: 'no-store' })
        if (res.status === 401) return // no session yet, leave it to the proxy
        if (!res.ok) return             // transient error, try again next tick
        const data = await res.json() as { ok: boolean; reason?: string }
        if (!data.ok) {
          stopped = true
          await supabase.auth.signOut()
          router.replace(`/login?reason=${encodeURIComponent(data.reason ?? 'suspended')}`)
        }
      } catch {
        // network blip — swallow and try next tick
      }
    }

    check() // fire once on mount so a page refresh kicks a suspended user immediately
    const id = window.setInterval(check, POLL_INTERVAL_MS)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)

    return () => {
      stopped = true
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [router])

  return null
}
