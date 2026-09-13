import type { SupabaseClient } from '@supabase/supabase-js'

// Plan seat cap. tenants.student_limit is NULL for "no cap" (full-university
// plan, and every tenant that existed before the column was added), so this
// changes nothing until a limit is actually set on a tenant.
//
// Counts ACTIVE students only — matches the pricing page promise that a
// deactivated/never-used seat doesn't count.
//
// Fails OPEN on a read error (e.g. the migration not yet applied on some
// environment): a billing cap must never be the thing that blocks a
// legitimate signup because of an unrelated DB hiccup. Must be called with
// the service-role client — it counts across the whole tenant.
export async function checkStudentLimit(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ allowed: boolean; limit: number | null; current: number | null }> {
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants').select('student_limit').eq('id', tenantId).single()

  if (tenantErr || !tenant || tenant.student_limit == null) {
    if (tenantErr) console.error('[student-limit] tenant read failed, allowing:', tenantErr.message)
    return { allowed: true, limit: null, current: null }
  }

  const { count, error: countErr } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('role', 'student')
    .eq('is_active', true)

  if (countErr || count == null) {
    console.error('[student-limit] count failed, allowing:', countErr?.message)
    return { allowed: true, limit: tenant.student_limit, current: null }
  }

  return { allowed: count < tenant.student_limit, limit: tenant.student_limit, current: count }
}

export const STUDENT_LIMIT_MESSAGE =
  'وصلت مؤسستك إلى الحد الأقصى لعدد الطلاب في باقتها الحالية. تواصل مع إدارة المنصة لترقية الباقة. ' +
  'Your institution has reached the student limit for its current plan.'
