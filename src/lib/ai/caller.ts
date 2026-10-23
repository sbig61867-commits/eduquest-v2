import { currentCtx } from '@/lib/auth/current'
import type { SessionCtx } from '@/lib/auth/session'
import type { PermissionMap } from '@/lib/permissions'
import { run, maybeOne } from '@/lib/db/sql'
import { aiRateLimitsFrom, type AiRateLimits } from '@/lib/settings'

// Who is calling an AI route, read once per request. The role and the
// institution come from the session context; the capability columns
// (permissions, can_create_courses) are not in it, so routes that gate on them
// read the caller's own row — together with the AI rate limits from the
// platform settings, in the same unit. authorizeAiUsage() then re-checks the
// caller live (active, same institution) before any provider call.

export interface AiCaller {
  ctx: SessionCtx
  role: string
  tenantId: string | null
  permissions: PermissionMap
  canCreateCourses: boolean
  limits: AiRateLimits
}

/** The session caller with their capability columns and the AI rate limits (one unit, read as the user). */
export async function aiCaller(): Promise<AiCaller | null> {
  const ctx = await currentCtx()
  if (!ctx) return null
  const [me, settings] = await run({ as: 'user', userId: ctx.sub }, sql => [
    sql`select role, tenant_id, permissions, can_create_courses from public.users where id = ${ctx.sub}`,
    sql`select value from public.platform_settings where key = 'ai_rate_limits'`,
  ])
  const row = maybeOne<{ role: string; tenant_id: string | null; permissions: PermissionMap; can_create_courses: boolean | null }>(me)
  return {
    ctx,
    role: row?.role ?? '',
    tenantId: row?.tenant_id ?? null,
    permissions: row?.permissions ?? null,
    canCreateCourses: row?.can_create_courses === true,
    limits: aiRateLimitsFrom(maybeOne<{ value: unknown }>(settings)?.value),
  }
}

/** The AI rate limits from the platform settings (readable by every signed-in user). */
export async function aiRateLimitsAs(userId: string): Promise<AiRateLimits> {
  const [rows] = await run({ as: 'user', userId }, sql => [
    sql`select value from public.platform_settings where key = 'ai_rate_limits'`,
  ])
  return aiRateLimitsFrom(maybeOne<{ value: unknown }>(rows)?.value)
}
