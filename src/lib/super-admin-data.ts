import { run, maybeOne } from '@/lib/db/sql'
import { aiRateLimitsFrom, examPoliciesFrom, invitationDefaultsFrom, deletionPolicyFrom, type AiRateLimits, type ExamPolicies, type InvitationDefaults, type DeletionPolicy } from '@/lib/settings'
import { seatStatus, SEAT_ROLES, type SeatRole, type SeatStatus } from '@/lib/seat-limit'
import { storageStatus, type StorageStatus } from '@/lib/storage-quota'
import { mergeAiPricing, type AiPricing } from '@/lib/ai/pricing'
export interface TenantRoleCounts { admins: number; teachers: number; students: number }

// The owner's (super_admin) reads, on the SQL layer, read as the caller. RLS
// grants the owner cross-tenant reads; every function here only runs for the
// owner's own session, and the database policies decide what is visible.

/** One platform_settings value, as the caller (any authenticated user may read it). */
export async function platformSettingAs(userId: string, key: string): Promise<unknown> {
  const [rows] = await run({ as: 'user', userId }, sql => [sql`select value from public.platform_settings where key = ${key}`])
  return maybeOne<{ value: unknown }>(rows)?.value
}

export const aiRateLimitsAs = async (userId: string): Promise<AiRateLimits> => aiRateLimitsFrom(await platformSettingAs(userId, 'ai_rate_limits'))
export const examPoliciesAs = async (userId: string): Promise<ExamPolicies> => examPoliciesFrom(await platformSettingAs(userId, 'exam_policies'))
export const deletionPolicyAs = async (userId: string): Promise<DeletionPolicy> => deletionPolicyFrom(await platformSettingAs(userId, 'deletion_policy'))
export const invitationDefaultsAs = async (userId: string): Promise<InvitationDefaults> => invitationDefaultsFrom(await platformSettingAs(userId, 'invitation_defaults'))

/** Both roles' seat usage of one institution (the owner's institution cards). */
export async function seatUsageAs(userId: string, tenantId: string): Promise<Record<SeatRole, SeatStatus>> {
  const [rows] = await run({ as: 'user', userId }, sql => [
    sql`select t.student_limit, t.teacher_limit,
               (select count(*)::int from public.users u where u.tenant_id = t.id and u.role = 'student' and u.is_active) as students,
               (select count(*)::int from public.users u where u.tenant_id = t.id and u.role = 'teacher' and u.is_active) as teachers
          from public.tenants t where t.id = ${tenantId}`,
  ])
  const r = maybeOne<{ student_limit: number | null; teacher_limit: number | null; students: number; teachers: number }>(rows)
  const used = { student: r?.students ?? null, teacher: r?.teachers ?? null }
  return Object.fromEntries(SEAT_ROLES.map(role => [role, seatStatus(role === 'student' ? r?.student_limit : r?.teacher_limit, used[role])])) as Record<SeatRole, SeatStatus>
}

/** An institution's file storage usage against its limit (the owner's cards). */
export async function storageUsageAs(userId: string, tenantId: string, limitMb: unknown): Promise<StorageStatus> {
  const [rows] = await run({ as: 'user', userId }, sql => [sql`select public.tenant_storage_bytes(${tenantId}) as bytes`])
  const n = Number(maybeOne<{ bytes: unknown }>(rows)?.bytes)
  return storageStatus(limitMb, Number.isFinite(n) ? n : null)
}

/** Accounts per institution (admins, teachers, students) from get_tenant_role_counts. */
export async function tenantRoleCountsAs(userId: string): Promise<{ counts: Record<string, TenantRoleCounts>; error: boolean }> {
  try {
    const [rows] = await run({ as: 'user', userId }, sql => [sql`select * from public.get_tenant_role_counts()`])
    const counts: Record<string, TenantRoleCounts> = {}
    for (const r of rows as unknown as { tenant_id: string; admins: number | string; teachers: number | string; students: number | string }[]) {
      counts[r.tenant_id] = { admins: Number(r.admins), teachers: Number(r.teachers), students: Number(r.students) }
    }
    return { counts, error: false }
  } catch (e) {
    console.error('[tenant-counts]', e instanceof Error ? e.message : e)
    return { counts: {}, error: true }
  }
}

/** The AI price table (platform_settings 'ai_pricing'), merged with the defaults. Kept here, not in
 * src/lib/ai/pricing.ts, which the browser's pricing editor imports. */
export async function readAiPricingAs(userId: string): Promise<AiPricing> {
  return mergeAiPricing(await platformSettingAs(userId, 'ai_pricing'))
}
