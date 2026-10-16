// Static mock data for the public /demo experience. No Supabase calls —
// every demo page renders straight from these fixtures so the whole flow
// works with zero backend cost and zero risk to real tenant data.
//
// This file owns the fixture ids, numbers and dates; the text of each fixture
// lives per language in src/content/demo/{ar,en}.ts (sample CONTENT, not UI,
// so it is not in the message files). A prospect browsing the demo in English
// sees English sample data, and a number is written once for both languages.
import type { Locale } from '@/i18n/config'
import { demoText as ar } from '@/content/demo/ar'
import { demoText as en } from '@/content/demo/en'

/** `days` from `now` as YYYY-MM-DD (UTC). The sample is anchored to today,
 *  so its "upcoming" exam is always ahead and its graded ones always behind. */
function dayFrom(now: Date, days: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10)
}

export type DemoExam =
  | { id: string; title: string; date: string; duration: number; submissions: number; status: 'graded'; score: number; outOf: number }
  | { id: string; title: string; date: string; duration: number; submissions: number; status: 'upcoming' }

export function getDemoData(locale: Locale, now: Date = new Date()) {
  const x = locale === 'ar' ? ar : en

  const tenant = { name: x.tenantName, slug: 'al-ofoq' }

  const teachers = [
    { id: 't1', ...x.teachers.t1, groups: 3, students: 74 },
    { id: 't2', ...x.teachers.t2, groups: 2, students: 51 },
    { id: 't3', ...x.teachers.t3, groups: 2, students: 48 },
    { id: 't4', ...x.teachers.t4, groups: 1, students: 29 },
  ]

  const students = [
    { id: 's1', ...x.students.s1, avgGrade: 88 },
    { id: 's2', ...x.students.s2, avgGrade: 94 },
    { id: 's3', ...x.students.s3, avgGrade: 76 },
    { id: 's4', ...x.students.s4, avgGrade: 91 },
    { id: 's5', ...x.students.s5, avgGrade: 83 },
  ]

  const courses = [
    { id: 'c1', ...x.courses.c1, units: 6, published: true },
    { id: 'c2', ...x.courses.c2, units: 5, published: true },
    { id: 'c3', ...x.courses.c3, units: 8, published: false },
    { id: 'c4', ...x.courses.c4, units: 4, published: true },
  ]

  const exams: DemoExam[] = [
    { id: 'e1', title: x.exams.e1, date: dayFrom(now, -15), duration: 60, submissions: 68, status: 'graded', score: 42, outOf: 50 },
    { id: 'e2', title: x.exams.e2, date: dayFrom(now, 5), duration: 90, submissions: 0, status: 'upcoming' },
    { id: 'e3', title: x.exams.e3, date: dayFrom(now, -26), duration: 20, submissions: 45, status: 'graded', score: 18, outOf: 20 },
  ]
  const upcomingExams = exams.filter(e => e.status === 'upcoming')

  const grades = [
    ...exams.flatMap(e => (e.status === 'graded' ? [{ exam: e.title, score: e.score, outOf: e.outOf }] : [])),
    { exam: x.homeworkTitle, score: 27, outOf: 30 },
  ]

  const announcements = [
    { id: 'a1', ...x.announcements.a1, date: dayFrom(now, -3) },
    { id: 'a2', ...x.announcements.a2, date: dayFrom(now, -6) },
  ]

  // Day is an index (0=Sunday), resolved through `common.days` by the page.
  const schedule = ([0, 1, 2, 3, 4] as const).map(day => ({ day, slots: x.schedule[day] }))

  const requests = [
    { id: 'r1', from: teachers[0].name, subject: x.requests.r1, status: 'pending' as const },
    { id: 'r2', from: teachers[1].name, subject: x.requests.r2, status: 'answered' as const },
  ]

  const teacherGroups = [
    { name: x.teacherGroups[0], count: 24 },
    { name: x.teacherGroups[1], count: 22 },
    { name: x.teacherGroups[2], count: 28 },
  ]

  const stats = { teachers: teachers.length, students: 214, courses: courses.length, exams: exams.length }

  return { tenant, teachers, students, courses, exams, upcomingExams, grades, announcements, schedule, requests, teacherGroups, stats }
}
