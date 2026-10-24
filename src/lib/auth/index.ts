import { currentUser } from './current'

// Stage 4 (step 6) access layer for identity. Code outside this folder asks
// "who is signed in" here instead of calling the auth provider directly, so
// the provider (Better Auth inside our Worker, src/lib/auth/better.ts) is
// swapped in one place.
// See docs/MIGRATION_CLOUDFLARE_NEON.md.

export type SessionUser = { id: string; email?: string }

// The signed-in user for a route handler (id and email). Writes are re-checked
// against the live account by the proxy before the handler runs.
export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await currentUser()
  return user ? { id: user.id, email: user.email } : null
}

