import { NextResponse } from 'next/server'
import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { staffCan } from '@/lib/staff-auth'
import type { Capability } from '@/lib/permissions'
import type { SessionCtx } from '@/lib/auth/session'
import { loadSchoolCaller, type SchoolCaller } from '@/lib/data/school-structure'

// The one gate of /api/school/*: a live staff account of a SCHOOL holding
// manage_academic_structure (university_admin default ON, centre manager
// default OFF, teachers and students never), rate-limited per user. Writes
// that follow run as app_service pinned to caller.tenant_id. The section
// timetable routes (/api/school/timetable) ask for manage_schedules instead,
// the capability every timetable write already needs (/api/schedules/*).

export const schoolErr = async (code: ApiErrorCode, status: number, params?: Record<string, string | number>) =>
  NextResponse.json({ ...(await apiErr(code, params)) }, { status })

/** `ctx` is the route's own currentCtx() (the session the proxy verified). */
export async function authorizeSchool(
  ctx: SessionCtx | null,
  feature: string,
  limit: number,
  capability: Capability = 'manage_academic_structure',
): Promise<{ caller: SchoolCaller } | { response: NextResponse }> {
  const caller = await loadSchoolCaller(ctx)
  if (caller === null) return { response: await schoolErr('unauthorized', 401) }
  if (caller === 'none' || !staffCan(caller, capability)) return { response: await schoolErr('forbidden', 403) }
  if (caller.institution_type !== 'school') return { response: await schoolErr('schoolOnly', 409) }
  const rl = await rateLimit(`${feature}:${caller.id}`, { limit, windowSecs: 60 })
  if (!rl.allowed) return { response: await schoolErr('rateLimited', 429) }
  return { caller }
}
