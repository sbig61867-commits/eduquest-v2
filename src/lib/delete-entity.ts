import { FALLBACK_DELETION_POLICY } from './settings'
import { run, maybeOne } from '@/lib/db/sql'

const TABLE: Record<string, string> = {
  group: 'groups', lesson: 'lessons', exam: 'exams', course: 'courses',
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
