import type { SupabaseClient } from '@/lib/db'
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

export async function createAuthUser(
  _admin: SupabaseClient,
  input: { email: string; password: string; fullName: string },
): Promise<{ id: string; error: null } | { id: null; error: AuthAdminError }> {
  return authCreateUser({ email: input.email, password: input.password, name: input.fullName })
}

export async function deleteAuthUser(_admin: SupabaseClient, id: string): Promise<{ error: AuthAdminError | null }> {
  return authRemoveUser(id)
}

/**
 * Sets a new password (every session of the account ends). With
 * `mustChangePassword` the flag is written too, as app_service on `tenantId`:
 * true for a temporary password chosen by staff, false once the person chose it.
 */
export async function setAuthPassword(
  _admin: SupabaseClient,
  id: string,
  password: string,
  flag?: { mustChangePassword: boolean; tenantId: string },
): Promise<{ error: AuthAdminError | null }> {
  const { error } = await authSetPassword(id, password)
  if (error || !flag) return { error }
  await run({ as: 'service', tenantId: flag.tenantId }, sql => [
    sql`update public.users set must_change_password = ${flag.mustChangePassword} where id = ${id}`,
  ])
  return { error: null }
}

/** The account's email and temporary-password flag, read as app_service on its institution. */
export async function getAuthAccount(
  _admin: SupabaseClient,
  id: string,
  tenantId: string,
): Promise<{ email: string | null; mustChangePassword: boolean } | null> {
  const [rows] = await run({ as: 'service', tenantId }, sql => [
    sql`select email, must_change_password from public.users where id = ${id}`,
  ])
  const row = maybeOne<{ email: string | null; must_change_password: boolean }>(rows)
  return row ? { email: row.email, mustChangePassword: row.must_change_password === true } : null
}

/** The id of the account this email and password sign in to, or null. Opens no session. */
export async function verifyPassword(email: string, password: string): Promise<string | null> {
  return authVerifyPassword(email, password)
}
