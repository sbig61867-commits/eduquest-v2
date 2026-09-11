// Static mock data for the public /demo experience. No Supabase calls —
// every demo page renders straight from these fixtures so the whole flow
// works with zero backend cost and zero risk to real tenant data.

export const demoTenant = {
  name: 'جامعة الأفق',
  slug: 'al-ofoq',
}

export const demoTeachers = [
  { id: 't1', name: 'د. سامر الحوراني', subject: 'برمجة أنظمة', groups: 3, students: 74 },
  { id: 't2', name: 'أ. لينا مطر', subject: 'قواعد بيانات', groups: 2, students: 51 },
  { id: 't3', name: 'د. عمر الشريف', subject: 'ذكاء اصطناعي', groups: 2, students: 48 },
  { id: 't4', name: 'أ. رنا قاسم', subject: 'شبكات حاسوب', groups: 1, students: 29 },
]

export const demoStudents = [
  { id: 's1', name: 'يزن العبدالله', group: 'برمجة - A', avgGrade: 88 },
  { id: 's2', name: 'ملك أبو زيد', group: 'قواعد بيانات - B', avgGrade: 94 },
  { id: 's3', name: 'كريم دويري', group: 'ذكاء اصطناعي - A', avgGrade: 76 },
  { id: 's4', name: 'جود النابلسي', group: 'برمجة - B', avgGrade: 91 },
  { id: 's5', name: 'تالا سالم', group: 'شبكات - A', avgGrade: 83 },
]

export const demoCourses = [
  { id: 'c1', title: 'أساسيات البرمجة', level: 'سنة أولى', units: 6, published: true },
  { id: 'c2', title: 'قواعد البيانات العلائقية', level: 'سنة ثانية', units: 5, published: true },
  { id: 'c3', title: 'مقدمة في الذكاء الاصطناعي', level: 'سنة ثالثة', units: 8, published: false },
  { id: 'c4', title: 'أمن الشبكات', level: 'سنة رابعة', units: 4, published: true },
]

export const demoExams = [
  { id: 'e1', title: 'اختبار منتصف الفصل - برمجة', date: '2026-10-01', duration: 60, submissions: 68 },
  { id: 'e2', title: 'اختبار نهائي - قواعد بيانات', date: '2026-10-14', duration: 90, submissions: 0 },
  { id: 'e3', title: 'كويز أسبوعي - ذكاء اصطناعي', date: '2026-09-20', duration: 20, submissions: 45 },
]

export const demoGrades = [
  { exam: 'اختبار منتصف الفصل - برمجة', score: 42, outOf: 50 },
  { exam: 'كويز أسبوعي - ذكاء اصطناعي', score: 18, outOf: 20 },
  { exam: 'واجب قواعد البيانات', score: 27, outOf: 30 },
]

export const demoAnnouncements = [
  { id: 'a1', title: 'تعديل موعد الاختبار النهائي', body: 'تم تأجيل الاختبار النهائي لمادة قواعد البيانات إلى 14 أكتوبر.', date: '2026-09-08' },
  { id: 'a2', title: 'ورشة عمل الذكاء الاصطناعي', body: 'ورشة مجانية للطلاب المهتمين يوم الخميس القادم في المدرج الرئيسي.', date: '2026-09-05' },
]

export const demoSchedule = [
  { day: 'الأحد', slots: ['برمجة أنظمة — 9:00', 'قواعد بيانات — 11:00'] },
  { day: 'الإثنين', slots: ['ذكاء اصطناعي — 10:00'] },
  { day: 'الثلاثاء', slots: ['شبكات حاسوب — 9:00', 'برمجة أنظمة — 13:00'] },
  { day: 'الأربعاء', slots: ['قواعد بيانات — 11:00'] },
  { day: 'الخميس', slots: ['ذكاء اصطناعي — 10:00', 'شبكات حاسوب — 12:00'] },
]

export const demoRequests = [
  { id: 'r1', from: 'د. سامر الحوراني', subject: 'طلب إضافة مجموعة جديدة', status: 'قيد المراجعة' },
  { id: 'r2', from: 'أ. لينا مطر', subject: 'استفسار حول صلاحيات الرصد', status: 'تم الرد' },
]

export const demoStats = {
  teachers: demoTeachers.length,
  students: 214,
  courses: demoCourses.length,
  exams: demoExams.length,
}
