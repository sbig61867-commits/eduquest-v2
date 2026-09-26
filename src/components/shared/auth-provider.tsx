'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { Tenant } from '@/types'
import { toTenantSettings } from '@/lib/structure-mode'

// Named user columns; the embedded tenant is `*` so its optional settings
// columns (institution_type, structure_mode, has_center) come through in the
// same round-trip when they exist, and are simply absent when they don't —
// this used to be a second, separate tenants query on every load.
const PROFILE_SELECT =
  'id, full_name, email, role, is_active, tenant_id, avatar_url, can_create_courses, is_university_student, created_at, tenants(*)'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setTenant, setLoading, reset } = useAuthStore()
  const supabase = createClient()

  useEffect(() => {
    let latestLoad = 0

    async function applyProfile(userId: string, loadId: number) {
      const { data: profile, error } = await supabase
        .from('users')
        .select(PROFILE_SELECT)
        .eq('id', userId)
        .single()
      if (loadId !== latestLoad) return
      if (error) console.error('[auth-provider] profile fetch failed', error.message)
      if (profile) {
        setUser(profile as Parameters<typeof setUser>[0])
        const row = (profile.tenants as unknown as Record<string, unknown> | null) ?? null
        setTenant(row ? ({ ...row, ...toTenantSettings(row) } as unknown as Tenant) : null)
      }
      setLoading(false)
    }

    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { setLoading(false); return }

      const cached = useAuthStore.getState()
      if (cached.user?.id === session.user.id) {
        // Show cached data immediately — re-fetch in background to pick up changes
        setLoading(false)
        applyProfile(session.user.id, ++latestLoad)
        return
      }

      // No cache for this user — wait for the first fetch before unblocking
      await applyProfile(session.user.id, ++latestLoad)
    }

    loadUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || !session) { reset(); return }
        // TOKEN_REFRESHED only rotates the JWT — profile data is unchanged.
        // SIGNED_IN also fires when an existing session is re-confirmed (every
        // tab refocus), so only fetch when it is a different account than the
        // one already loaded — loadUser() above has the current one covered.
        if (event === 'SIGNED_IN' && useAuthStore.getState().user?.id !== session.user.id) {
          await applyProfile(session.user.id, ++latestLoad)
        }
      }
    )

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}</>
}
