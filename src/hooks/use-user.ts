'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'

export function useUser() {
  const { user, tenant, isLoading, setUser, setTenant, setLoading } = useAuthStore()
  const supabase = createClient()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session?.user) {
          setUser(null)
          setTenant(null)
          setLoading(false)
          return
        }

        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('*, tenants(*)')
          .eq('id', session.user.id)
          .single()

        if (profileError) {
          console.error('[use-user] profile fetch failed', profileError.message)
        }
        if (profile) {
          setUser(profile)
          setTenant(profile.tenants ?? null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, tenant, isLoading }
}
