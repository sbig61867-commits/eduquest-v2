import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client: bypasses row-level security. Server code only, after the
// caller's own authorization has been checked. Created per call (no shared
// state), with sessions disabled.
export function createAdminClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Public-key client with no session. Used only to check a password (sign in on a
// throwaway client, then sign it out) so the caller's own session is untouched.
export function createAnonClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
