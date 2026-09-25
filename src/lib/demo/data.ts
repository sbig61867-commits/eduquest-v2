// Static mock data for the public /demo experience. No Supabase calls —
// every demo page renders straight from these fixtures so the whole flow
// works with zero backend cost and zero risk to real tenant data.
//
// Bilingual on purpose. This is sample CONTENT, not UI, so it is not in the
// message files — but a prospect browsing the demo in English must not be
// shown a screen full of Arabic sample data either. Each text field is
// written as an Arabic/English pair side by side, so the two versions of a
// fixture cannot drift apart; numbers are written once.
import type { Locale } from '@/i18n/config'

export function getDemoData(locale: Locale) {
  const x = (ar: string, en: string) => (locale === 'ar' ? ar : en)

  const tenant = { name: x('جامعة الأفق', 'Horizon University'), slug: 'al-ofoq' }

  const teachers = [
    { id: 't1', name: x('د. سامر الحوراني', 'Dr. Samer Hourani'), subject: x('برمجة أنظمة', 'Systems Programming'), groups: 3, students: 74 },
    { id: 't2', name: x('أ. لينا مطر', 'Ms. Lina Matar'), subject: x('قواعد بيانات', 'Databases'), groups: 2, students: 51 },
    { id: 't3', name: x('د. عمر الشريف', 'Dr. Omar Sharif'), subject: x('ذكاء اصطناعي', 'Artificial Intelligence'), groups: 2, students: 48 },
    { id: 't4', name: x('أ. رنا قاسم', 'Ms. Rana Qasem'), subject: x('شبكات حاسوب', 'Computer Networks'), groups: 1, students: 29 },
  ]

  const students = [
    { id: 's1', name: x('يزن العبدالله', 'Yazan Abdullah'), group: x('برمجة - A', 'Programming - A'), avgGrade: 88 },
    { id: 's2', name: x('ملك أبو زيد', 'Malak Abu Zaid'), group: x('قواعد بيانات - B', 'Databases - B'), avgGrade: 94 },
    { id: 's3', name: x('كريم دويري', 'Karim Duwairi'), group: x('ذكاء اصطناعي - A', 'AI - A'), avgGrade: 76 },
    { id: 's4', name: x('جود النابلسي', 'Joud Nabulsi'), group: x('برمجة - B', 'Programming - B'), avgGrade: 91 },
    { id: 's5', name: x('تالا سالم', 'Tala Salem'), group: x('شبكات - A', 'Networks - A'), avgGrade: 83 },
  ]

  const courses = [
    { id: 'c1', title: x('أساسيات البرمجة', 'Programming Fundamentals'), level: x('سنة أولى', 'Year 1'), units: 6, published: true },
    { id: 'c2', title: x('قواعد البيانات العلائقية', 'Relational Databases'), level: x('سنة ثانية', 'Year 2'), units: 5, published: true },
    { id: 'c3', title: x('مقدمة في الذكاء الاصطناعي', 'Introduction to AI'), level: x('سنة ثالثة', 'Year 3'), units: 8, published: false },
    { id: 'c4', title: x('أمن الشبكات', 'Network Security'), level: x('سنة رابعة', 'Year 4'), units: 4, published: true },
  ]

  const exams = [
    { id: 'e1', title: x('اختبار منتصف الفصل - برمجة', 'Midterm - Programming'), date: '2026-10-01', duration: 60, submissions: 68 },
    { id: 'e2', title: x('اختبار نهائي - قواعد بيانات', 'Final - Databases'), date: '2026-10-14', duration: 90, submissions: 0 },
    { id: 'e3', title: x('كويز أسبوعي - ذكاء اصطناعي', 'Weekly Quiz - AI'), date: '2026-09-20', duration: 20, submissions: 45 },
  ]

  const grades = [
    { exam: exams[0].title, score: 42, outOf: 50 },
    { exam: exams[2].title, score: 18, outOf: 20 },
    { exam: x('واجب قواعد البيانات', 'Databases Homework'), score: 27, outOf: 30 },
  ]

  const announcements = [
    { id: 'a1', title: x('تعديل موعد الاختبار النهائي', 'Final exam rescheduled'),
      body: x('تم تأجيل الاختبار النهائي لمادة قواعد البيانات إلى 14 أكتوبر.', 'The Databases final exam has been moved to October 14.'),
      date: '2026-09-08' },
    { id: 'a2', title: x('ورشة عمل الذكاء الاصطناعي', 'AI workshop'),
      body: x('ورشة مجانية للطلاب المهتمين يوم الخميس القادم في المدرج الرئيسي.', 'A free workshop for interested students next Thursday in the main hall.'),
      date: '2026-09-05' },
  ]

  // Day is an index (0=Sunday), resolved through `common.days` by the page.
  const schedule = [
    { day: 0, slots: [x('برمجة أنظمة — 9:00', 'Systems Programming — 9:00'), x('قواعد بيانات — 11:00', 'Databases — 11:00')] },
    { day: 1, slots: [x('ذكاء اصطناعي — 10:00', 'AI — 10:00')] },
    { day: 2, slots: [x('شبكات حاسوب — 9:00', 'Computer Networks — 9:00'), x('برمجة أنظمة — 13:00', 'Systems Programming — 13:00')] },
    { day: 3, slots: [x('قواعد بيانات — 11:00', 'Databases — 11:00')] },
    { day: 4, slots: [x('ذكاء اصطناعي — 10:00', 'AI — 10:00'), x('شبكات حاسوب — 12:00', 'Computer Networks — 12:00')] },
  ]

  const requests = [
    { id: 'r1', from: teachers[0].name, subject: x('طلب إضافة مجموعة جديدة', 'Request to add a new group'), status: 'pending' as const },
    { id: 'r2', from: teachers[1].name, subject: x('استفسار حول صلاحيات الرصد', 'Question about grading permissions'), status: 'answered' as const },
  ]

  const teacherGroups = [
    { name: x('برمجة - A', 'Programming - A'), count: 24 },
    { name: x('برمجة - B', 'Programming - B'), count: 22 },
    { name: x('ذكاء اصطناعي - A', 'AI - A'), count: 28 },
  ]

  const stats = { teachers: teachers.length, students: 214, courses: courses.length, exams: exams.length }

  return { tenant, teachers, students, courses, exams, grades, announcements, schedule, requests, teacherGroups, stats }
}
