import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Lightweight auth for server components: verifies the JWT locally via
// getClaims() instead of a network round-trip to the Auth server (getUser()).
// The proxy has already gated the request, so this is a cheap re-read of the
// same claims. Route handlers doing privileged writes should keep getUser().
export type AuthUser = { id: string; email?: string; role?: string; tenant_id?: string | null }

export async function getAuthUser(supabase: SupabaseClient): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) return null
  const meta = (claims.app_metadata ?? {}) as Record<string, unknown>
  // The sync_user_claims trigger writes the role under `user_role` (see
  // supabase/fix_auth_flow.sql) — reading `meta.role` here silently yielded
  // undefined and every role check downstream returned 403.
  const role = meta.user_role ?? meta.role
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    role: typeof role === 'string' ? role : undefined,
    tenant_id: typeof meta.tenant_id === 'string' ? meta.tenant_id : null,
  }
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
