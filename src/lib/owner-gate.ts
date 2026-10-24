import { currentUser } from '@/lib/auth/current'
import type { Sql } from '@/lib/db/sql'

/**
 * The owner gate for the platform's write routes: the caller's LIVE role (the
 * database row, not the token), as a SQL condition for the statement itself —
 * so a demoted owner, or a stale session, writes nothing.
 */
export function ownerGate(sql: Sql, userId: string) {
  return sql`exists (select 1 from public.users o where o.id = ${userId} and o.role = 'super_admin')`
}

/** The caller when signed in; null otherwise. The route answers 401 / 403 on null / refusal. */
export async function ownerCaller() {
  const user = await currentUser()
  return user?.id ? { id: user.id } : null
}
