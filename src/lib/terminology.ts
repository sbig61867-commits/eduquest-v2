import type { InstitutionType } from '@/types'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config'

// UI vocabulary per institution type. The database keeps its original names
// (university_admin, groups, …) because they are baked into RLS policies and
// JWT claims — only what the user reads changes. A missing/unknown type falls
// back to 'university', which reproduces the app's pre-existing wording.
//
// ── Boundary with i18n (established in Phase 0b, not yet implemented) ──
//
// Terminology and translation are different axes and must not be merged:
//
//   translation  — the same concept, said in another language.
//                  Lives in src/messages/<locale>/*.json, keyed by meaning.
//                  Varies by LOCALE.
//   terminology  — a different concept word for the same underlying entity,
//                  chosen per institution: a `group` is a فصل in a school, a
//                  دفعة in a training centre, a فريق in a company.
//                  Varies by TENANT (tenants.institution_type).
//
// Collapsing them would multiply the message files by five institution types
// and make every tenant-wording change a translation change. So the target
// shape is a locale-keyed overlay — `Record<Locale, Record<InstitutionType,
// Terms>>` — resolved ON TOP of the `terms` message namespace
// (src/messages/<locale>/terms.json), which holds the neutral defaults.
//
// ── Converted (i18n Phase 0) ──
//
// The table below IS that locale-keyed overlay. Before this, the interface
// carried a single set of fields plus `*Ar` duplicates, and an earlier
// Arabic pass had rewritten the base fields to Arabic too — so both halves
// said the same thing and the English wording was gone, not merely unused.
// Switching the locale could not have changed tenant vocabulary at all.
//
// `getTerms(type, locale)` now takes the locale explicitly. It defaults to
// DEFAULT_LOCALE so the 45 existing call sites keep rendering exactly what
// they render today; each one starts passing a real locale as its screen is
// migrated.

export const INSTITUTION_TYPES: InstitutionType[] = [
  'university', 'school', 'institute', 'training_center', 'company',
]

export interface Terms {
  institutionTypeLabel: string
  institution: string        // "University" / "الجامعة"
  institutionAdmin: string   // role label for university_admin
  group: string
  groups: string
  unitL1: string             // top level of the academic structure
  unitsL1: string
  unitL2: string             // second level
  unitsL2: string
  term: string               // academic period
  terms: string
  institutionStudent: string  // singular
  institutionStudents: string // plural
}

const AR: Record<InstitutionType, Terms> = {
  university: {
    institutionTypeLabel: 'جامعة',
    institution: 'الجامعة', institutionAdmin: 'مدير الجامعة',
    group: 'مجموعة', groups: 'المجموعات',
    unitL1: 'كلية', unitsL1: 'الكليات', unitL2: 'قسم', unitsL2: 'الأقسام',
    term: 'فصل دراسي', terms: 'الفصول الدراسية',
    institutionStudent: 'طالب جامعة', institutionStudents: 'طلاب الجامعة',
  },
  school: {
    institutionTypeLabel: 'مدرسة',
    institution: 'المدرسة', institutionAdmin: 'مدير المدرسة',
    group: 'فصل', groups: 'الفصول',
    unitL1: 'مرحلة', unitsL1: 'المراحل', unitL2: 'صف', unitsL2: 'الصفوف',
    term: 'فصل', terms: 'الفصول',
    institutionStudent: 'طالب مدرسة', institutionStudents: 'طلاب المدرسة',
  },
  institute: {
    institutionTypeLabel: 'معهد',
    institution: 'المعهد', institutionAdmin: 'مدير المعهد',
    group: 'شعبة', groups: 'الشعب',
    unitL1: 'شعبة رئيسية', unitsL1: 'الشعب الرئيسية', unitL2: 'برنامج', unitsL2: 'البرامج',
    term: 'فصل', terms: 'الفصول',
    institutionStudent: 'طالب معهد', institutionStudents: 'طلاب المعهد',
  },
  training_center: {
    institutionTypeLabel: 'مركز تدريب',
    institution: 'المركز', institutionAdmin: 'مدير المركز',
    group: 'دفعة', groups: 'الدفعات',
    unitL1: 'مسار', unitsL1: 'المسارات', unitL2: 'برنامج', unitsL2: 'البرامج',
    term: 'دورة', terms: 'الدورات',
    institutionStudent: 'متدرب', institutionStudents: 'متدربو المركز',
  },
  company: {
    institutionTypeLabel: 'شركة',
    institution: 'المؤسسة', institutionAdmin: 'مدير التدريب',
    group: 'فريق', groups: 'الفرق',
    unitL1: 'إدارة', unitsL1: 'الإدارات', unitL2: 'وحدة', unitsL2: 'الوحدات',
    term: 'فترة', terms: 'الفترات',
    institutionStudent: 'موظف متدرب', institutionStudents: 'موظفو المؤسسة',
  },
}

const EN: Record<InstitutionType, Terms> = {
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
    institutionTypeLabel: 'Training Center',
    institution: 'Center', institutionAdmin: 'Center Manager',
    group: 'Cohort', groups: 'Cohorts',
    unitL1: 'Track', unitsL1: 'Tracks', unitL2: 'Program', unitsL2: 'Programs',
    term: 'Course Run', terms: 'Course Runs',
    institutionStudent: 'Trainee', institutionStudents: 'Trainees',
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

const TERMS: Record<Locale, Record<InstitutionType, Terms>> = { ar: AR, en: EN }

export function isInstitutionType(value: unknown): value is InstitutionType {
  return typeof value === 'string' && (INSTITUTION_TYPES as string[]).includes(value)
}

/**
 * Tenant vocabulary for a locale.
 *
 * `locale` defaults to the platform default so pre-migration call sites keep
 * their current output; pass the real locale (`useLocale()` on the client,
 * `getLocale()` on the server) when migrating a screen.
 */
export function getTerms(type?: string | null, locale: Locale = DEFAULT_LOCALE): Terms {
  return TERMS[locale][isInstitutionType(type) ? type : 'university']
}
