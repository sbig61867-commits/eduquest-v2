// English text of the /demo sample data. Mirrors src/content/demo/ar.ts.
import type { DemoText } from './types'

export const demoText: DemoText = {
  tenantName: 'Horizon University',
  teachers: {
    t1: { name: 'Dr. Samer Hourani', subject: 'Systems Programming' },
    t2: { name: 'Ms. Lina Matar', subject: 'Databases' },
    t3: { name: 'Dr. Omar Sharif', subject: 'Artificial Intelligence' },
    t4: { name: 'Ms. Rana Qasem', subject: 'Computer Networks' },
  },
  students: {
    s1: { name: 'Yazan Abdullah', group: 'Programming - A' },
    s2: { name: 'Malak Abu Zaid', group: 'Databases - B' },
    s3: { name: 'Karim Duwairi', group: 'AI - A' },
    s4: { name: 'Joud Nabulsi', group: 'Programming - B' },
    s5: { name: 'Tala Salem', group: 'Networks - A' },
  },
  courses: {
    c1: { title: 'Programming Fundamentals', level: 'Year 1' },
    c2: { title: 'Relational Databases', level: 'Year 2' },
    c3: { title: 'Introduction to AI', level: 'Year 3' },
    c4: { title: 'Network Security', level: 'Year 4' },
  },
  exams: {
    e1: 'Midterm - Programming',
    e2: 'Final - Databases',
    e3: 'Weekly Quiz - AI',
  },
  homeworkTitle: 'Databases Homework',
  announcements: {
    a1: { title: 'Final exam rescheduled', body: 'The Databases final exam has been moved to October 14.' },
    a2: { title: 'AI workshop', body: 'A free workshop for interested students next Thursday in the main hall.' },
  },
  schedule: {
    0: ['Systems Programming — 9:00', 'Databases — 11:00'],
    1: ['AI — 10:00'],
    2: ['Computer Networks — 9:00', 'Systems Programming — 13:00'],
    3: ['Databases — 11:00'],
    4: ['AI — 10:00', 'Computer Networks — 12:00'],
  },
  requests: {
    r1: 'Request to add a new group',
    r2: 'Question about grading permissions',
  },
  teacherGroups: ['Programming - A', 'Programming - B', 'AI - A'],
}
