import { getAnonDb, type SupabaseClient } from '@/lib/db'

// Server-only account operations (service role). A route authorizes the
// caller with the user session first, then calls these with the admin client.
// The provider behind them (Supabase Auth today) changes here only, in
// step 6d of docs/MIGRATION_CLOUDFLARE_NEON.md.

export type AuthAdminError = {
  message: string
  /** An account with this email already exists. */
  duplicate: boolean
  /** The provider rejected the email's format (stricter than our own check). */
  invalidEmail: boolean
  /** The provider's original error, for logs. */
  raw: unknown
}

type ProviderError = { message?: string; code?: string; status?: number }

function adminError(e: ProviderError): AuthAdminError {
  const message = e.message ?? ''
  const m = message.toLowerCase()
  return {
    message,
    // Supabase signals a duplicate via several shapes depending on version:
    // message contains "already"/"registered"/"exists", code 'email_exists', or HTTP 422.
    duplicate: m.includes('already') || m.includes('registered') || m.includes('exists')
      || e.code === 'email_exists' || e.status === 422,
    invalidEmail: /invalid format/i.test(message),
    raw: e,
  }
}

export async function createAuthUser(
  admin: SupabaseClient,
  input: { email: string; password: string; fullName: string; mustChangePassword?: boolean },
): Promise<{ id: string; error: null } | { id: null; error: AuthAdminError }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    // app_metadata is service-role only, so the person cannot clear the flag.
    ...(input.mustChangePassword ? { app_metadata: { must_change_password: true } } : {}),
    user_metadata: { full_name: input.fullName },
  })
  if (error || !data.user) return { id: null, error: adminError(error ?? { message: 'no user returned' }) }
  return { id: data.user.id, error: null }
}

export async function deleteAuthUser(admin: SupabaseClient, id: string): Promise<{ error: AuthAdminError | null }> {
  const { error } = await admin.auth.admin.deleteUser(id)
  return { error: error ? adminError(error) : null }
}

/** Sets a new password. `mustChangePassword` true: a temporary password chosen
 *  by staff; false: the person chose it; omitted: the flag is left as it is. */
export async function setAuthPassword(
  admin: SupabaseClient,
  id: string,
  password: string,
  opts: { mustChangePassword?: boolean } = {},
): Promise<{ error: AuthAdminError | null }> {
  const { error } = await admin.auth.admin.updateUserById(id, {
    password,
    ...(opts.mustChangePassword === undefined ? {} : { app_metadata: { must_change_password: opts.mustChangePassword } }),
  })
  return { error: error ? adminError(error) : null }
}

export async function getAuthAccount(
  admin: SupabaseClient,
  id: string,
): Promise<{ email: string | null; mustChangePassword: boolean } | null> {
  const { data } = await admin.auth.admin.getUserById(id)
  if (!data?.user) return null
  return { email: data.user.email ?? null, mustChangePassword: data.user.app_metadata?.must_change_password === true }
}

/** The id of the account this email and password sign in to, or null. The
 *  check's own session is ended at once (it never reaches a cookie). */
export async function verifyPassword(email: string, password: string): Promise<string | null> {
  const verifier = getAnonDb()
  const { data, error } = await verifier.auth.signInWithPassword({ email, password })
  if (error || !data?.user) return null
  await verifier.auth.signOut({ scope: 'local' })
  return data.user.id
}

/** The language of emails the provider sends this person (password reset). */
export async function setAuthEmailLocale(admin: SupabaseClient, id: string, locale: string): Promise<void> {
  await admin.auth.admin.updateUserById(id, { user_metadata: { locale } })
}
