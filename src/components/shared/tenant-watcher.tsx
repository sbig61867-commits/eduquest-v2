'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Watches the current user's university for suspension/deletion in real-time.
// When the tenant is suspended or deleted, signs out the session immediately
// rather than waiting for the next JWT refresh (which can be up to ~1 hour).
// No-ops for super_admin (no tenant_id in app_metadata).
export function TenantWatcher() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    let channelRef: ReturnType<typeof supabase.channel> | null = null

    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const tenantId = session.user.app_metadata?.tenant_id as string | undefined
      if (!tenantId) return // super_admin — no tenant to watch

      channelRef = supabase
        .channel(`tenant-watcher:${tenantId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'universities', filter: `id=eq.${tenantId}` },
          async (payload) => {
            const row = payload.new as { subscription_status?: string } | null
            const kicked =
              payload.eventType === 'DELETE' ||
              (row?.subscription_status && row.subscription_status !== 'active')
            if (kicked) {
              await supabase.auth.signOut()
              router.replace('/login?reason=suspended')
            }
          }
        )
        .subscribe()
    })()

    return () => {
      if (channelRef) supabase.removeChannel(channelRef)
    }
  }, [router])

  return null
}
