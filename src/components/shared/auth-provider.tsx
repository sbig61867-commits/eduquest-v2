'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { Tenant } from '@/types'
import { toTenantSettings } from '@/lib/structure-mode'

// Only the columns consumed by the app — avoids SELECT *
const PROFILE_SELECT =
  'id, full_name, email, role, is_active, tenant_id, avatar_url, can_create_courses, is_university_student, created_at, tenants(id, name, slug, logo_url, is_active, created_at)'

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
        const tenant = (profile.tenants as unknown as Tenant | null) ?? null
        // Fetched separately (not in PROFILE_SELECT) so the profile load keeps
        // working on a DB where institution_type_migration.sql isn't applied yet
        // — an unknown column would fail the whole embedded select.
        if (tenant) {
          // `*`, not named columns: a column that doesn't exist yet is simply absent.
          const { data: extra } = await supabase
            .from('tenants').select('*').eq('id', tenant.id).maybeSingle()
          if (loadId !== latestLoad) return
          Object.assign(tenant, toTenantSettings(extra as Record<string, unknown> | null))
        }
        setTenant(tenant)
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
