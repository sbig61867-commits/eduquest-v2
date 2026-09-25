// Arabic UI vocabulary per institution type, and Arabic role names.
// Read through getTerms()/getRoleLabel() — src/lib/terminology.ts, src/lib/utils.ts.
import type { InstitutionType } from '@/types'
import type { Terms } from '@/lib/terminology'
import type { RoleLabels } from './types'

export const institutionTerms: Record<InstitutionType, Terms> = {
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

export const roleLabels: RoleLabels = {
  super_admin: 'المدير العام',
  center_manager: 'مدير المركز',
  teacher: 'معلم',
  student: 'طالب',
}
