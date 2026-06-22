'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setTenant, setLoading, reset } = useAuthStore()
  const supabase = createClient()

  useEffect(() => {
    // Serialize profile loads: loadUser first, then listener handles future events
    let latestLoad = 0

    async function applyProfile(userId: string, loadId: number) {
      const { data: profile } = await supabase
        .from('users')
        .select('*, tenants(*)')
        .eq('id', userId)
        .single()
      // Discard result if a newer load started (race condition guard)
      if (loadId !== latestLoad) return
      if (profile) {
        setUser(profile)
        setTenant(profile.tenants ?? null)
      }
      setLoading(false)
    }

    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { setLoading(false); return }
      latestLoad++
      await applyProfile(session.user.id, latestLoad)
    }

    loadUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          reset()
          return
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          latestLoad++
          await applyProfile(session.user.id, latestLoad)
        }
      }
    )

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}</>
}
