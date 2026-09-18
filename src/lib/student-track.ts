// Which "track" a student is on — decides the student interface.
//
//   institution  a full student of the university/school: can belong to the
//                academic structure (faculty › department) when the tenant
//                has switched it on.
//   centre       a continuing-education trainee registered through the
//                centre (users.is_university_student = false). Never shown
//                faculties/departments; the interface names the centre instead.
//
// A tenant without a centre (tenants.has_center = false) only has the
// institution track, whatever the flag says.

export type StudentTrack = 'institution' | 'centre'

export function getStudentTrack(
  isUniversityStudent: boolean | null | undefined,
  tenantHasCenter: boolean | null | undefined,
): StudentTrack {
  return tenantHasCenter !== false && isUniversityStudent === false ? 'centre' : 'institution'
}

export const CENTRE_TRAINEE_LABEL = 'متدرب المركز'
export const CENTRE_TRAINEE_LABEL_AR = 'متدرب مركز التعليم المستمر'
