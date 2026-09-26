// English UI vocabulary per institution type, and English role names.
// Read through getTerms()/getRoleLabel() — src/lib/terminology.ts, src/lib/utils.ts.
// Naming rule: see ar.ts — the institution admin and the continuing education
// manager must never share a label.
import type { InstitutionType } from '@/types'
import type { Terms } from '@/lib/terminology'
import type { RoleLabels } from './types'

export const institutionTerms: Record<InstitutionType, Terms> = {
  university: {
    institutionTypeLabel: 'University',
    institution: 'University', institutionAdmin: 'University Admin',
    group: 'Group', groups: 'Groups',
    unitL1: 'Faculty', unitsL1: 'Faculties', unitL2: 'Department', unitsL2: 'Departments',
    term: 'Semester', terms: 'Semesters',
    institutionStudent: 'University Student', institutionStudents: 'University Students',
  },
  school: {
    institutionTypeLabel: 'School',
    institution: 'School', institutionAdmin: 'School Admin',
    group: 'Class', groups: 'Classes',
    unitL1: 'Stage', unitsL1: 'Stages', unitL2: 'Grade', unitsL2: 'Grades',
    term: 'Term', terms: 'Terms',
    institutionStudent: 'School Student', institutionStudents: 'School Students',
  },
  institute: {
    institutionTypeLabel: 'Institute',
    institution: 'Institute', institutionAdmin: 'Institute Admin',
    group: 'Section', groups: 'Sections',
    unitL1: 'Division', unitsL1: 'Divisions', unitL2: 'Program', unitsL2: 'Programs',
    term: 'Term', terms: 'Terms',
    institutionStudent: 'Institute Student', institutionStudents: 'Institute Students',
  },
  training_center: {
    institutionTypeLabel: 'Training Centre',
    institution: 'Training Centre', institutionAdmin: 'Training Centre Director',
    group: 'Cohort', groups: 'Cohorts',
    unitL1: 'Track', unitsL1: 'Tracks', unitL2: 'Program', unitsL2: 'Programs',
    term: 'Course Run', terms: 'Course Runs',
    institutionStudent: 'Trainee', institutionStudents: 'Training Centre Trainees',
  },
  company: {
    institutionTypeLabel: 'Company',
    institution: 'Organization', institutionAdmin: 'Training Manager',
    group: 'Team', groups: 'Teams',
    unitL1: 'Division', unitsL1: 'Divisions', unitL2: 'Unit', unitsL2: 'Units',
    term: 'Period', terms: 'Periods',
    institutionStudent: 'Employee Trainee', institutionStudents: 'Employee Trainees',
  },
}

export const roleLabels: RoleLabels = {
  super_admin: 'Owner',
  center_manager: 'Centre Manager',
  teacher: 'Teacher',
  student: 'Student',
}
