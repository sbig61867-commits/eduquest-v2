import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Owner Counts (Batch 2): accounts per institution for /super-admin/users —
 * university_admin («admins»), teacher, student, any status (as the page always
 * counted). One row per institution from get_tenant_role_counts()
 * (supabase/owner_counts_migration.sql — SECURITY INVOKER, owner only), never
 * every user row.
 */

export interface TenantRoleCounts { admins: number; teachers: number; students: number }

export async function loadTenantRoleCounts(
  db: SupabaseClient,
): Promise<{ counts: Record<string, TenantRoleCounts>; error: boolean }> {
  const { data, error } = await db.rpc('get_tenant_role_counts')
  if (error) {
    console.error('[tenant-counts]', error)
    return { counts: {}, error: true }
  }
  const counts: Record<string, TenantRoleCounts> = {}
  for (const r of (data ?? []) as { tenant_id: string; admins: number | string; teachers: number | string; students: number | string }[]) {
    counts[r.tenant_id] = { admins: Number(r.admins), teachers: Number(r.teachers), students: Number(r.students) }
  }
  return { counts, error: false }
}
