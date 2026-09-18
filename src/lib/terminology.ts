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
    institutionTypeLabel: 'جامعة',
    institution: 'الجامعة', institutionAdmin: 'مدير الجامعة',
    group: 'مجموعة', groups: 'المجموعات',
    unitL1: 'كلية', unitsL1: 'الكليات', unitL2: 'قسم', unitsL2: 'الأقسام',
    term: 'فصل دراسي', terms: 'الفصول الدراسية',
    institutionStudent: 'طالب جامعة',
    institutionAr: 'الجامعة', institutionAdminAr: 'مدير الجامعة', groupsAr: 'المجموعات',
    institutionStudentAr: 'طالب جامعة', institutionStudentsAr: 'طلاب الجامعة',
  },
  school: {
    institutionTypeLabel: 'مدرسة',
    institution: 'المدرسة', institutionAdmin: 'مدير المدرسة',
    group: 'فصل', groups: 'الفصول',
    unitL1: 'مرحلة', unitsL1: 'المراحل', unitL2: 'صف', unitsL2: 'الصفوف',
    term: 'فصل', terms: 'الفصول',
    institutionStudent: 'طالب مدرسة',
    institutionAr: 'المدرسة', institutionAdminAr: 'مدير المدرسة', groupsAr: 'الفصول',
    institutionStudentAr: 'طالب مدرسة', institutionStudentsAr: 'طلاب المدرسة',
  },
  institute: {
    institutionTypeLabel: 'معهد',
    institution: 'المعهد', institutionAdmin: 'مدير المعهد',
    group: 'شعبة', groups: 'الشعب',
    unitL1: 'شعبة رئيسية', unitsL1: 'الشعب الرئيسية', unitL2: 'برنامج', unitsL2: 'البرامج',
    term: 'فصل', terms: 'الفصول',
    institutionStudent: 'طالب معهد',
    institutionAr: 'المعهد', institutionAdminAr: 'مدير المعهد', groupsAr: 'الشعب',
    institutionStudentAr: 'طالب معهد', institutionStudentsAr: 'طلاب المعهد',
  },
  training_center: {
    institutionTypeLabel: 'مركز تدريب',
    institution: 'المركز', institutionAdmin: 'مدير المركز',
    group: 'دفعة', groups: 'الدفعات',
    unitL1: 'مسار', unitsL1: 'المسارات', unitL2: 'برنامج', unitsL2: 'البرامج',
    term: 'دورة', terms: 'الدورات',
    institutionStudent: 'متدرب',
    institutionAr: 'المركز', institutionAdminAr: 'مدير المركز', groupsAr: 'الدفعات',
    institutionStudentAr: 'متدرب', institutionStudentsAr: 'متدربو المركز',
  },
  company: {
    institutionTypeLabel: 'شركة',
    institution: 'المؤسسة', institutionAdmin: 'مدير التدريب',
    group: 'فريق', groups: 'الفرق',
    unitL1: 'إدارة', unitsL1: 'الإدارات', unitL2: 'وحدة', unitsL2: 'الوحدات',
    term: 'فترة', terms: 'الفترات',
    institutionStudent: 'موظف متدرب',
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
