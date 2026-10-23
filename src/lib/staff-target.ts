import { run, maybeOne } from '@/lib/db/sql'
import { serviceScopeFor } from '@/lib/auth/current'
import type { SessionCtx } from '@/lib/auth/session'
import { teacherFootprints, type TeacherFootprint } from '@/lib/account-scope'
import { seatStatus, type SeatRole, type SeatStatus } from '@/lib/seat-limit'
import { toTenantSettings, type TenantSettings } from '@/lib/structure-mode'

// What a staff write about one account needs to decide, read in ONE unit as
// app_service pinned to the caller's institution (the owner: platform scope):
//  - the caller's LIVE row (role, institution, capabilities, active) — never
//    the session alone, so a demoted or deactivated admin decides nothing;
//  - the target account, visible only inside that scope: an account of
//    another institution is simply not found;
//  - on request, the target's teaching footprint (centre-manager scope rules),
//    the seat usage of the target's institution, and its settings.
// The write that follows runs in the same scope and repeats its conditions.

type FootRow = { teacher_id: string | null; course_id?: string | null }

export interface StaffMe {
  role: string
  tenant_id: string | null
  permissions: Record<string, unknown> | null
}

export interface TargetAccount {
  id: string
  role: string
  tenant_id: string | null
  is_active: boolean | null
  is_university_student: boolean | null
  full_name: string | null
}

export interface StaffTarget {
  me: StaffMe | null
  target: TargetAccount | null
  footprint: TeacherFootprint
  seats: Record<SeatRole, SeatStatus> | null
  settings: TenantSettings | null
}

export async function loadStaffTarget(
  ctx: SessionCtx,
  targetId: string,
  opts: { footprint?: boolean; seats?: boolean; settings?: boolean } = {},
): Promise<StaffTarget | null> {
  const scope = serviceScopeFor(ctx)
  if (!scope) return null
  const rows = await run(scope, sql => [
    sql`select role, tenant_id, permissions from public.users where id = ${ctx.sub} and is_active is not false`,
    sql`select id, role, tenant_id, is_active, is_university_student, full_name from public.users where id = ${targetId}`,
    ...(opts.footprint ? [
      sql`select g.teacher_id, g.course_id from public.groups g
           where g.teacher_id = ${targetId} and g.deleted_at is null
             and g.tenant_id = (select tenant_id from public.users where id = ${targetId})`,
      sql`select c.teacher_id from public.courses c
           where c.teacher_id = ${targetId} and c.deleted_at is null
             and c.tenant_id = (select tenant_id from public.users where id = ${targetId})`,
    ] : []),
    ...(opts.seats || opts.settings ? [
      sql`select to_jsonb(t) as tenant,
                 (select count(*) from public.users u where u.tenant_id = t.id and u.role = 'student' and u.is_active)::int as students,
                 (select count(*) from public.users u where u.tenant_id = t.id and u.role = 'teacher' and u.is_active)::int as teachers
            from public.tenants t
           where t.id = (select tenant_id from public.users where id = ${targetId})`,
    ] : []),
  ])
  const me = maybeOne<StaffMe>(rows[0])
  const target = maybeOne<TargetAccount>(rows[1])
  let i = 2
  const none: TeacherFootprint = { universityGroups: 0, centreItems: 0 }
  const footprint = opts.footprint
    ? (teacherFootprints(rows[i++] as unknown as FootRow[], rows[i++] as unknown as FootRow[]).get(targetId) ?? none)
    : none
  const t = opts.seats || opts.settings ? maybeOne<{ tenant: Record<string, unknown>; students: number; teachers: number }>(rows[i]) : null
  return {
    me,
    target,
    footprint,
    seats: opts.seats && t ? {
      student: seatStatus(t.tenant.student_limit, t.students),
      teacher: seatStatus(t.tenant.teacher_limit, t.teachers),
    } : null,
    settings: opts.settings && t ? toTenantSettings(t.tenant) : null,
  }
}
