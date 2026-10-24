'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import type { Tenant } from '@/types'
import { toTenantSettings } from '@/lib/structure-mode'
import { AccountSwitchNotice } from './account-switch-notice'

// The client account store, filled from GET /api/auth/profile (own row and
// institution, read as the user). This provider sits inside every role
// layout, and signing in or out is always a full page load (login page,
// join form, lib/sign-out.ts), so loading once on mount is enough: there is
// no in-page session change to listen for. Switching accounts in another tab
// is caught by <AccountSwitchNotice>.

type Profile = { user: Record<string, unknown>; tenant: Record<string, unknown> | null }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setTenant, setLoading, reset } = useAuthStore()

  useEffect(() => {
    let alive = true

    async function load() {
      const res = await fetch('/api/auth/profile', { cache: 'no-store' }).catch(() => null)
      if (!alive) return
      if (res?.status === 401) { reset(); setLoading(false); return }
      const profile = res?.ok ? await res.json().catch(() => null) as Profile | null : null
      if (!alive) return
      if (!profile) {
        console.error('[auth-provider] profile fetch failed', res?.status)
        setLoading(false)
        return
      }
      setUser(profile.user as unknown as Parameters<typeof setUser>[0])
      const row = profile.tenant
      setTenant(row ? ({ ...row, ...toTenantSettings(row) } as unknown as Tenant) : null)
      setLoading(false)
    }

    // A cached account for this device shows immediately; the fetch refreshes it.
    if (useAuthStore.getState().user) setLoading(false)
    void load()
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}<AccountSwitchNotice /></>
}
