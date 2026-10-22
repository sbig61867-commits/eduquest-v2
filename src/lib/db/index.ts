// The one place the app gets its database and auth handles (stage 3 of the
// Cloudflare + Neon migration, docs/MIGRATION_CLOUDFLARE_NEON.md).
//
// Today both handles are Supabase clients, so behaviour does not change. The
// rest of the code imports from here only; when Neon replaces Supabase, only
// the bodies of these functions change.
//
//   getDb()      the caller's own session: row-level security applies
//   getAdminDb() privileged server work: bypasses row-level security, server only
export { createClient as getDb } from '@/lib/supabase/server'
export { createAdminClient as getAdminDb } from '@/lib/supabase/admin'
export { getAuthUser, type AuthUser } from '@/lib/supabase/server'

// Types only (erased at build time; no runtime import). Code that needs the
// handle's shape imports it from here, not from the vendor package.
export type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
