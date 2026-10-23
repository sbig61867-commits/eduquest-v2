import type { SupabaseClient } from '@/lib/db'
import { FALLBACK_DELETION_POLICY, getDeletionPolicy } from './settings'
import { run, maybeOne } from '@/lib/db/sql'

const TABLE: Record<string, string> = {
  group: 'groups', lesson: 'lessons', exam: 'exams', course: 'courses',
}

// Deletes an entity honoring the owner's platform deletion policy:
//   hard_delete_enabled = true  → permanent DELETE (FK-cascades to children)
//   hard_delete_enabled = false → soft-delete/archive via the RPC (default)
// `admin` bypasses RLS for the write; `reader` is any client that can read
// platform_settings (the caller's session client is fine).
export async function deleteEntity(
  admin: SupabaseClient,
  reader: SupabaseClient,
  kind: 'group' | 'lesson' | 'exam' | 'course',
  id: string,
  actorId: string,
  tenantId: string,
): Promise<{ error: unknown; mode: 'hard' | 'archive' }> {
  const { hard_delete_enabled } = await getDeletionPolicy(reader)

  if (hard_delete_enabled) {
    const { error } = await admin.from(TABLE[kind]).delete().eq('id', id).eq('tenant_id', tenantId)
    return { error, mode: 'hard' }
  }

  const { error } = await admin.rpc('soft_delete_entity', {
    p_kind: kind, p_id: id, p_actor: actorId, p_tenant_id: tenantId,
  })
  return { error, mode: 'archive' }
}

/**
 * The same on the SQL layer (step 9). The owner's deletion policy is read as
 * the actor; the delete (or the archive, soft_delete_entity) runs as
 * app_service pinned to the institution, so a row of another institution can
 * never be touched. Replaces deleteEntity once its last caller has moved.
 */
export async function deleteEntityAs(
  actorId: string,
  tenantId: string,
  kind: 'group' | 'lesson' | 'exam' | 'course',
  id: string,
): Promise<{ error: unknown; mode: 'hard' | 'archive' }> {
  let hard = FALLBACK_DELETION_POLICY.hard_delete_enabled
  try {
    const [rows] = await run({ as: 'user', userId: actorId }, sql => [
      sql`select value from public.platform_settings where key = 'deletion_policy'`,
    ])
    const v = (maybeOne<{ value: Partial<{ hard_delete_enabled: boolean }> | null }>(rows)?.value ?? {})
    hard = v.hard_delete_enabled ?? hard
  } catch { /* the fallback policy stands */ }

  const service = { as: 'service', tenantId } as const
  try {
    if (hard) {
      // one fixed statement per table (no identifier is built from input)
      await run(service, sql => [
        kind === 'group' ? sql`delete from public.groups where id = ${id} and tenant_id = ${tenantId}`
          : kind === 'lesson' ? sql`delete from public.lessons where id = ${id} and tenant_id = ${tenantId}`
            : kind === 'exam' ? sql`delete from public.exams where id = ${id} and tenant_id = ${tenantId}`
              : sql`delete from public.courses where id = ${id} and tenant_id = ${tenantId}`,
      ])
      return { error: null, mode: 'hard' }
    }
    await run(service, sql => [sql`select public.soft_delete_entity(${kind}, ${id}, ${actorId}, ${tenantId})`])
    return { error: null, mode: 'archive' }
  } catch (error) {
    return { error, mode: hard ? 'hard' : 'archive' }
  }
}
