import { vi } from 'vitest'
import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

// findBy*/waitFor default to 1 s. The exam-screen suites render the whole
// proctored exam page, and under the full parallel run (70+ files) one of them
// occasionally needed longer than that and failed on time alone, not on
// behaviour (seen 2026-09-30, 1 run in 3). Assertions are unchanged.
configure({ asyncUtilTimeout: 5000 })

// ── Step 9.6 transition bridge (remove when step 9 is complete) ──────────────
// Route tests written before the identity move supply the signed-in user
// through a mocked Supabase client (auth.getUser / auth.getClaims). The app now
// reads identity from the signed session context (src/lib/auth/current.ts).
// Until each route moves to the SQL layer and its test supplies the user
// directly, the identity source reads it from that same mock, so those tests
// keep checking authorization instead of all failing at "who is signed in".
type LegacyAuth = {
  getUser?: () => Promise<{ data?: { user?: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null } }>
  getClaims?: () => Promise<{ data?: { claims?: { sub?: string; email?: string; app_metadata?: Record<string, unknown> } | null } }>
}
vi.mock('@/lib/auth/current', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/auth/current')>()
  async function legacyUser() {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const auth = ((await createClient()) as unknown as { auth?: LegacyAuth } | null)?.auth
      if (auth?.getUser) {
        const u = (await auth.getUser()).data?.user
        if (u) return { id: u.id, email: u.email, role: u.app_metadata?.user_role as string | undefined, tenant_id: (u.app_metadata?.tenant_id as string | undefined) ?? null }
      }
      if (auth?.getClaims) {
        const c = (await auth.getClaims()).data?.claims
        if (c?.sub) {
          const m = c.app_metadata ?? {}
          return { id: c.sub, email: c.email, role: (m.user_role ?? m.role) as string | undefined, tenant_id: (m.tenant_id as string | undefined) ?? null }
        }
      }
    } catch { /* no legacy mock in this test */ }
    return null
  }
  return {
    ...actual,
    currentUser: async () => (await legacyUser()) ?? actual.currentUser().catch(() => null),
    currentCtx: async () => {
      const u = await legacyUser()
      if (!u) return actual.currentCtx().catch(() => null)
      return { sub: u.id, email: u.email ?? null, role: u.role ?? null, tenant_id: u.tenant_id, is_active: true, must_change_password: false }
    },
  }
})
