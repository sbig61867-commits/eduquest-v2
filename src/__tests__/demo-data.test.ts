import { describe, expect, it } from 'vitest'
import { getDemoData } from '@/lib/demo/data'
import { demoText as ar } from '@/content/demo/ar'
import { demoText as en } from '@/content/demo/en'

// The public /demo is what a prospect sees first. Found 2026-10-16: its dates
// were fixed strings, so "upcoming" exams were weeks in the past, graded exams
// still offered "Enter exam", and the teacher's sample students sat in groups
// the teacher does not have. The sample is now anchored to the day it renders.
const DAYS = ['2026-10-16T09:00:00Z', '2026-12-31T23:30:00Z', '2027-03-01T00:10:00Z', '2030-07-15T12:00:00Z']
const iso = (d: Date) => d.toISOString().slice(0, 10)

describe('demo data stays current on any day', () => {
  for (const day of DAYS) {
    const now = new Date(day)
    const d = getDemoData('ar', now)

    it(`${day}: upcoming exams are ahead, graded ones behind`, () => {
      expect(d.upcomingExams.length).toBeGreaterThan(0)
      for (const e of d.exams) {
        if (e.status === 'upcoming') expect(e.date > iso(now)).toBe(true)
        else expect(e.date < iso(now)).toBe(true)
      }
    })

    it(`${day}: announcements are dated in the past`, () => {
      for (const a of d.announcements) expect(a.date < iso(now)).toBe(true)
    })
  }

  it('upcomingExams is exactly the exams marked upcoming', () => {
    const d = getDemoData('en', new Date(DAYS[0]))
    expect(d.upcomingExams.map(e => e.id)).toEqual(d.exams.filter(e => e.status === 'upcoming').map(e => e.id))
  })

  it('every exam grade belongs to a graded exam, with its own score', () => {
    const d = getDemoData('en', new Date(DAYS[0]))
    for (const e of d.exams) {
      const g = d.grades.find(x => x.exam === e.title)
      if (e.status === 'graded') expect(g).toEqual({ exam: e.title, score: e.score, outOf: e.outOf })
      else expect(g).toBeUndefined()
    }
  })

  it('dates are YYYY-MM-DD', () => {
    const d = getDemoData('ar', new Date(DAYS[1]))
    for (const x of [...d.exams, ...d.announcements]) expect(x.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('demo sample text', () => {
  for (const [locale, x] of [['ar', ar], ['en', en]] as const) {
    it(`${locale}: sample students are in the teacher's groups`, () => {
      for (const s of Object.values(x.students)) expect(x.teacherGroups).toContain(s.group)
    })

    it(`${locale}: no calendar date written into the text (it would go stale)`, () => {
      const text = JSON.stringify(x)
      expect(text).not.toMatch(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/)
      expect(text).not.toMatch(/(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر|كانون|شباط|آذار|نيسان|أيار|حزيران|تموز|آب|أيلول|تشرين)/)
      expect(text).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/)
    })
  }
})
