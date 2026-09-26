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

import type { SupabaseClient } from '@supabase/supabase-js'

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

/** Loads one teacher's footprint (live rows only). Errors fail closed — the teacher counts as shared. */
export async function loadTeacherFootprint(client: SupabaseClient, tenantId: string, teacherId: string): Promise<TeacherFootprint> {
  const [groups, courses] = await Promise.all([
    client.from('groups').select('teacher_id, course_id').eq('tenant_id', tenantId).eq('teacher_id', teacherId).is('deleted_at', null),
    client.from('courses').select('teacher_id').eq('tenant_id', tenantId).eq('teacher_id', teacherId).is('deleted_at', null),
  ])
  if (groups.error || courses.error) return { universityGroups: 1, centreItems: 0 }
  return teacherFootprints(groups.data ?? [], courses.data ?? []).get(teacherId) ?? { universityGroups: 0, centreItems: 0 }
}
