import { run, maybeOne } from '@/lib/db/sql'
import { authCreateUser, authRemoveUser, authSetPassword, authVerifyPassword, type AuthAdminError } from './better'

// Server-only account operations. A route authorizes the caller with the
// session first, then calls these. Since step 9.6 the accounts live in Better
// Auth (src/lib/auth/better.ts) and the "must choose a new password" flag is
// the column public.users.must_change_password, written as app_service pinned
// to the account's institution.
// The client argument of each function is kept so existing call sites stay
// unchanged; it is not used.

export type { AuthAdminError }

/** The id of the account this email and password sign in to, or null. Opens no session. */
export async function verifyPassword(email: string, password: string): Promise<string | null> {
  return authVerifyPassword(email, password)
}
