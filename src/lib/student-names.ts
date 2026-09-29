import type { SupabaseClient } from '@supabase/supabase-js'
import { fourPartName, shortStudentName, type NameParts } from '@/lib/person-name'

// Where a student's name lives (owner's rule, 2026-09-28): the four parts only
// in `student_names`, which RLS opens to that student alone (and the owner);
// `users.full_name` holds first + family name, so every other screen, report,
// export and email shows exactly that without reading anything new.
// `users.name_complete` tells staff which students still lack a four-part name
// without letting them read it. supabase/student_name_lock_migration.sql.

interface DbError { code?: string; message?: string }

/** The migration has not been applied yet (PostgREST / Postgres "no such table"). */
function isMissingTable(error: DbError): boolean {
  const message = error.message ?? ''
  return error.code === 'PGRST205' || error.code === '42P01'
    || (/student_names/.test(message) && /not find|does not exist/i.test(message))
}

/**
 * Store a student's four parts (service-role client) and set their `users`
 * row to the short name. The profile row must already exist. Returns the
 * `full_name` now stored, for callers that write it again (accept_invitation).
 *
 * Before the migration there is nowhere private to keep the middle names, so
 * the whole name goes into `full_name` as before rather than being lost.
 */
export async function saveStudentName(admin: SupabaseClient, userId: string, parts: NameParts): Promise<string> {
  const { error } = await admin.from('student_names').upsert({
    user_id: userId,
    first_name: parts.first,
    father_name: parts.father,
    grandfather_name: parts.grandfather,
    family_name: parts.family,
    updated_at: new Date().toISOString(),
  })
  if (error && !isMissingTable(error)) throw new Error(`student_names: ${error.message}`)

  const saved = !error
  const fullName = saved ? shortStudentName(parts) : fourPartName(parts)
  const { error: userErr } = await admin
    .from('users')
    .update(saved ? { full_name: fullName, name_complete: true } : { full_name: fullName })
    .eq('id', userId)
  if (userErr) throw new Error(`users.full_name: ${userErr.message}`)
  return fullName
}

/**
 * The student's own four parts, read through THEIR session (RLS lets nobody
 * else read the row). Null for an account registered before four-part names,
 * or before the migration.
 */
export async function loadOwnStudentName(supabase: SupabaseClient, userId: string): Promise<NameParts | null> {
  const { data, error } = await supabase
    .from('student_names')
    .select('first_name, father_name, grandfather_name, family_name')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return { first: data.first_name, father: data.father_name, grandfather: data.grandfather_name, family: data.family_name }
}

/**
 * Which students of a tenant have a four-part name on file (for the staff
 * "name incomplete" flag). Null before the migration, when nothing is known.
 */
export async function loadNameCompleteFlags(supabase: SupabaseClient, tenantId: string): Promise<Map<string, boolean> | null> {
  const { data, error } = await supabase
    .from('users').select('id, name_complete').eq('tenant_id', tenantId).eq('role', 'student')
  if (error) return null
  return new Map((data ?? []).map(r => [r.id as string, r.name_complete === true]))
}
