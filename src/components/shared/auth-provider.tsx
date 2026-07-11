'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'

// Only the columns consumed by the app — avoids SELECT *
const PROFILE_SELECT =
  'id, full_name, email, role, is_active, tenant_id, avatar_url, can_create_courses, created_at, tenants(id, name, slug, logo_url, is_active, created_at)'

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
        setTenant((profile.tenants as unknown as Parameters<typeof setTenant>[0]) ?? null)
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
        // TOKEN_REFRESHED only rotates the JWT — profile data is unchanged
        if (event === 'SIGNED_IN') {
          await applyProfile(session.user.id, ++latestLoad)
        }
      }
    )

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}</>
}
