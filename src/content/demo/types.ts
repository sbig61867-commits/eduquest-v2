// Text of the public /demo fixtures, one file per language
// (src/content/demo/{ar,en}.ts). Keyed by the fixture ids used in
// src/lib/demo/data.ts, which owns the ids, numbers and dates — so a number is
// written once and the two languages cannot disagree on it.

type Id<K extends string, V> = Record<K, V>

export interface DemoText {
  tenantName: string
  teachers: Id<'t1' | 't2' | 't3' | 't4', { name: string; subject: string }>
  students: Id<'s1' | 's2' | 's3' | 's4' | 's5', { name: string; group: string }>
  courses: Id<'c1' | 'c2' | 'c3' | 'c4', { title: string; level: string }>
  exams: Id<'e1' | 'e2' | 'e3', string>
  homeworkTitle: string
  announcements: Id<'a1' | 'a2', { title: string; body: string }>
  /** Timetable slot labels, by day index (0 = Sunday). */
  schedule: Id<'0' | '1' | '2' | '3' | '4', string[]>
  requests: Id<'r1' | 'r2', string>
  teacherGroups: [string, string, string]
}
