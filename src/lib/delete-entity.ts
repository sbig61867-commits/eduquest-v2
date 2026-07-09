import type { SupabaseClient } from '@supabase/supabase-js'
import { getDeletionPolicy } from './settings'

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
