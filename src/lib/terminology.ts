import type { InstitutionType } from '@/types'

// UI vocabulary per institution type. The database keeps its original names
// (university_admin, groups, …) because they are baked into RLS policies and
// JWT claims — only what the user reads changes. A missing/unknown type falls
// back to 'university', which reproduces the app's pre-existing wording.

export const INSTITUTION_TYPES: InstitutionType[] = [
  'university', 'school', 'institute', 'training_center', 'company',
]

export interface Terms {
  institutionTypeLabel: string
  institution: string        // "University"
  institutionAdmin: string   // role label for university_admin
  group: string
  groups: string
  unitL1: string             // top level of the academic structure
  unitsL1: string
  unitL2: string             // second level
  unitsL2: string
  term: string               // academic period
  terms: string
  institutionStudent: string // student of the institution (vs. centre trainee)
  // Arabic forms, for the Arabic-language screens
  institutionAr: string      // "الجامعة"
  institutionAdminAr: string // "مدير الجامعة"
  groupsAr: string
  institutionStudentAr: string   // singular "طالب جامعة"
  institutionStudentsAr: string  // plural  "طلاب الجامعة"
}

const TERMS: Record<InstitutionType, Terms> = {
  university: {
    institutionTypeLabel: 'University',
    institution: 'University', institutionAdmin: 'University Admin',
    group: 'Group', groups: 'Groups',
    unitL1: 'Faculty', unitsL1: 'Faculties', unitL2: 'Department', unitsL2: 'Departments',
    term: 'Semester', terms: 'Semesters',
    institutionStudent: 'University student',
    institutionAr: 'الجامعة', institutionAdminAr: 'مدير الجامعة', groupsAr: 'المجموعات',
    institutionStudentAr: 'طالب جامعة', institutionStudentsAr: 'طلاب الجامعة',
  },
  school: {
    institutionTypeLabel: 'School',
    institution: 'School', institutionAdmin: 'School Admin',
    group: 'Class', groups: 'Classes',
    unitL1: 'Stage', unitsL1: 'Stages', unitL2: 'Grade', unitsL2: 'Grades',
    term: 'Term', terms: 'Terms',
    institutionStudent: 'School student',
    institutionAr: 'المدرسة', institutionAdminAr: 'مدير المدرسة', groupsAr: 'الفصول',
    institutionStudentAr: 'طالب مدرسة', institutionStudentsAr: 'طلاب المدرسة',
  },
  institute: {
    institutionTypeLabel: 'Institute',
    institution: 'Institute', institutionAdmin: 'Institute Admin',
    group: 'Section', groups: 'Sections',
    unitL1: 'Division', unitsL1: 'Divisions', unitL2: 'Program', unitsL2: 'Programs',
    term: 'Term', terms: 'Terms',
    institutionStudent: 'Institute student',
    institutionAr: 'المعهد', institutionAdminAr: 'مدير المعهد', groupsAr: 'الشعب',
    institutionStudentAr: 'طالب معهد', institutionStudentsAr: 'طلاب المعهد',
  },
  training_center: {
    institutionTypeLabel: 'Training Center',
    institution: 'Training Center', institutionAdmin: 'Center Admin',
    group: 'Cohort', groups: 'Cohorts',
    unitL1: 'Track', unitsL1: 'Tracks', unitL2: 'Program', unitsL2: 'Programs',
    term: 'Session', terms: 'Sessions',
    institutionStudent: 'Trainee',
    institutionAr: 'المركز', institutionAdminAr: 'مدير المركز', groupsAr: 'الدفعات',
    institutionStudentAr: 'متدرب', institutionStudentsAr: 'متدربو المركز',
  },
  company: {
    institutionTypeLabel: 'Company',
    institution: 'Organization', institutionAdmin: 'Training Admin',
    group: 'Team', groups: 'Teams',
    unitL1: 'Department', unitsL1: 'Departments', unitL2: 'Unit', unitsL2: 'Units',
    term: 'Period', terms: 'Periods',
    institutionStudent: 'Employee trainee',
    institutionAr: 'المؤسسة', institutionAdminAr: 'مدير التدريب', groupsAr: 'الفرق',
    institutionStudentAr: 'موظف متدرب', institutionStudentsAr: 'موظفو المؤسسة',
  },
}

export function isInstitutionType(value: unknown): value is InstitutionType {
  return typeof value === 'string' && (INSTITUTION_TYPES as string[]).includes(value)
}

export function getTerms(type?: string | null): Terms {
  return TERMS[isInstitutionType(type) ? type : 'university']
}
