import type { SupabaseClient } from '@/lib/db'

// Stage 4 (step 6) access layer for identity. Code outside this folder asks
// "who is signed in" here instead of calling the auth provider directly, so
// the provider (Supabase Auth today, Neon Auth next) is swapped in one place.
// See docs/MIGRATION_CLOUDFLARE_NEON.md.

export type SessionUser = { id: string; email?: string }

// Confirms the session with the auth server, not just the token signature.
// Use it before privileged writes; server components that only render can use
// getAuthUser (local token check) instead.
export async function getSessionUser(db: SupabaseClient): Promise<SessionUser | null> {
  const { data: { user } } = await db.auth.getUser()
  return user ? { id: user.id, email: user.email } : null
}

export { getAuthUser, type AuthUser } from '@/lib/supabase/server'
