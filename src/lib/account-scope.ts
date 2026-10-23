// Which accounts belong to the continuing-education centre, and which to the
// institution (university) itself.
//
// Teachers and students are SHARED between the two: one teacher may run
// university groups and centre courses at the same time, and a university
// student may also take a centre course. Deactivating an account locks it out
// of both, so the centre manager may (de)activate only people who exist purely
// on the centre side; anyone the university also relies on stays with the
// institution admin.
//
//   student — centre-only  ⇔  users.is_university_student = false
//   teacher — centre-only  ⇔  owns no live university group (a group with no
//             course_id) AND has a centre footprint (a live course, or a
//             course-linked group). A teacher with neither is not claimed by
//             the centre yet, so the institution admin decides.

import { run } from '@/lib/db/sql'

export type ScopeBlock = 'universityStudent' | 'sharedTeacher' | 'unassignedTeacher'

export interface TeacherFootprint {
  universityGroups: number
  centreItems: number
}

export function teacherBlock(f: TeacherFootprint): ScopeBlock | null {
  if (f.universityGroups > 0) return 'sharedTeacher'
  if (f.centreItems === 0) return 'unassignedTeacher'
  return null
}

export function studentBlock(isUniversityStudent: boolean | null | undefined): ScopeBlock | null {
  // NULL/undefined is treated as the column default (TRUE): university-owned.
  return isUniversityStudent === false ? null : 'universityStudent'
}

type Row = { teacher_id: string | null; course_id?: string | null }

/** Per-teacher footprint from the tenant's live groups and courses. */
export function teacherFootprints(groups: Row[], courses: Row[]): Map<string, TeacherFootprint> {
  const out = new Map<string, TeacherFootprint>()
  const get = (id: string) => {
    let f = out.get(id)
    if (!f) { f = { universityGroups: 0, centreItems: 0 }; out.set(id, f) }
    return f
  }
  for (const g of groups) {
    if (!g.teacher_id) continue
    if (g.course_id) get(g.teacher_id).centreItems++
    else get(g.teacher_id).universityGroups++
  }
  for (const c of courses) if (c.teacher_id) get(c.teacher_id).centreItems++
  return out
}

/**
 * One teacher's footprint (live rows only), read as app_service pinned to the
 * institution: groups and courses of that teacher, in one unit. Errors fail
 * closed — the teacher counts as shared.
 */
export async function loadTeacherFootprintSql(tenantId: string, teacherId: string): Promise<TeacherFootprint> {
  try {
    const [groups, courses] = await run({ as: 'service', tenantId }, sql => [
      sql`select teacher_id, course_id from public.groups where tenant_id = ${tenantId} and teacher_id = ${teacherId} and deleted_at is null`,
      sql`select teacher_id from public.courses where tenant_id = ${tenantId} and teacher_id = ${teacherId} and deleted_at is null`,
    ])
    return teacherFootprints(groups as unknown as Row[], courses as unknown as Row[]).get(teacherId) ?? { universityGroups: 0, centreItems: 0 }
  } catch {
    // as before: a failed read counts as a university-side teacher (the safe refusal)
    return { universityGroups: 1, centreItems: 0 }
  }
}
