import { describe, it, expect } from 'vitest'
import { buildNudges, buildStudyPlan, NUDGE_LIMITS, type NudgeExam, type NudgeInput } from '@/lib/assistant/nudges'

// The orb's messages and the study plan: pure functions over the student's own data.

const NOW = new Date('2026-10-15T09:00:00Z')
const HOUR = 3_600_000
const at = (days: number, hours = 0) => new Date(NOW.getTime() + days * 24 * HOUR + hours * HOUR).toISOString()

const exam = (over: Partial<NudgeExam> & { id: string }): NudgeExam => ({
  title: `T-${over.id}`, type: 'exam', starts_at: null, ends_at: null, lesson_id: null, ...over,
})

const input = (over: Partial<NudgeInput> = {}): NudgeInput => ({
  now: NOW, exams: [], submittedExamIds: new Set(), lessons: [], announcements: [], lessonTitles: {}, ...over,
})

describe('buildNudges', () => {
  it('lists deadlines within three days, soonest first, with the days left and a link to exams', () => {
    const nudges = buildNudges(input({
      exams: [
        exam({ id: 'b', type: 'homework', ends_at: at(2, 1) }),
        exam({ id: 'a', ends_at: at(0, 5) }),
        exam({ id: 'far', ends_at: at(5) }),
      ],
    }))
    const due = nudges.filter(n => n.kind === 'due')
    expect(due.map(n => n.id)).toEqual(['due:a', 'due:b'])
    expect(due[0].params).toEqual({ title: 'T-a', days: 0, type: 'exam' })
    expect(due[1].params).toEqual({ title: 'T-b', days: 2, type: 'homework' })
    expect(due.every(n => n.href === '/student/exams')).toBe(true)
  })

  it('skips submitted work and windows that already closed', () => {
    const nudges = buildNudges(input({
      exams: [exam({ id: 'done', ends_at: at(1) }), exam({ id: 'past', ends_at: at(-1) })],
      submittedExamIds: new Set(['done']),
    }))
    expect(nudges.map(n => n.kind)).toEqual(['welcome'])
  })

  it('suggests revising the linked lesson before an exam opens', () => {
    const nudges = buildNudges(input({
      exams: [
        exam({ id: 'e1', starts_at: at(4), ends_at: at(4, 2), lesson_id: 'L1' }),
        exam({ id: 'e2', starts_at: at(6), ends_at: at(6, 2) }),
        exam({ id: 'hw', type: 'homework', starts_at: at(2), ends_at: at(12) }),
      ],
      lessonTitles: { L1: 'الكسور' },
    }))
    expect(nudges.find(n => n.id === 'review:e1')).toMatchObject({
      kind: 'review', params: { title: 'T-e1', days: 4, lesson: 'الكسور' }, lessonId: 'L1',
    })
    expect(nudges.find(n => n.id === 'examSoon:e2')).toMatchObject({ kind: 'examSoon', params: { days: 6 } })
    expect(nudges.some(n => n.id.endsWith(':hw'))).toBe(false)
  })

  it('does not repeat an exam that already has a deadline nudge', () => {
    const nudges = buildNudges(input({ exams: [exam({ id: 'x', starts_at: at(1), ends_at: at(2) })] }))
    expect(nudges.filter(n => n.id.endsWith(':x')).map(n => n.kind)).toEqual(['due'])
  })

  it('adds a weekly plan when two or more items close this week', () => {
    const nudges = buildNudges(input({
      exams: [exam({ id: 'late', ends_at: at(6) }), exam({ id: 'soon', ends_at: at(5) })],
    }))
    expect(nudges.find(n => n.kind === 'plan')?.params).toEqual({ count: 2, first: 'T-soon' })
    expect(buildNudges(input({ exams: [exam({ id: 'one', ends_at: at(6) })] })).some(n => n.kind === 'plan')).toBe(false)
  })

  it('mentions one recent announcement by title, several by count, and ignores old ones', () => {
    const one = buildNudges(input({ announcements: [{ id: 'n1', title: 'رحلة', created_at: at(-1) }, { id: 'old', title: 'قديم', created_at: at(-5) }] }))
    expect(one.filter(n => n.kind.startsWith('announcement'))).toEqual([
      { id: 'announcement:n1', kind: 'announcement', params: { title: 'رحلة' }, href: '/student/dashboard' },
    ])
    const many = buildNudges(input({ announcements: [{ id: 'n1', title: 'a', created_at: at(-1) }, { id: 'n2', title: 'b', created_at: at(-2) }] }))
    expect(many.find(n => n.kind === 'announcements')?.params).toEqual({ count: 2 })
  })

  it('offers to summarise at most two lessons published this week', () => {
    const lessons = [
      { id: 'l1', title: 'أ', created_at: at(-1) },
      { id: 'l2', title: 'ب', created_at: at(-2) },
      { id: 'l3', title: 'ج', created_at: at(-3) },
      { id: 'old', title: 'د', created_at: at(-20) },
    ]
    const fresh = buildNudges(input({ lessons })).filter(n => n.kind === 'lesson')
    expect(fresh).toHaveLength(NUDGE_LIMITS.newLessons)
    expect(fresh[0]).toEqual({ id: 'lesson:l1', kind: 'lesson', params: { title: 'أ' }, lessonId: 'l1', href: '/student/lessons/l1' })
  })

  it('falls back to revising the latest lesson, then to a welcome', () => {
    const quiet = buildNudges(input({ lessons: [{ id: 'old', title: 'قديم', created_at: at(-30) }] }))
    expect(quiet).toEqual([{ id: 'quiet:old', kind: 'quiet', params: { title: 'قديم' }, lessonId: 'old' }])
    expect(buildNudges(input())).toEqual([{ id: 'welcome', kind: 'welcome', params: {} }])
  })

  it('never returns more than the cap', () => {
    const exams = Array.from({ length: 10 }, (_, i) => exam({ id: `d${i}`, ends_at: at(1, i) }))
    expect(buildNudges(input({ exams }))).toHaveLength(NUDGE_LIMITS.total)
  })
})

describe('buildStudyPlan', () => {
  it('lists the next two weeks soonest first, with a day to start revising', () => {
    const plan = buildStudyPlan(input({
      exams: [
        exam({ id: 'hw', type: 'homework', ends_at: at(9) }),
        exam({ id: 'ex', starts_at: at(1), ends_at: at(1, 2), lesson_id: 'L' }),
        exam({ id: 'far', ends_at: at(20) }),
        exam({ id: 'sub', ends_at: at(3) }),
      ],
      submittedExamIds: new Set(['sub']),
      lessonTitles: { L: 'المعادلات' },
    }))
    expect(plan).toEqual([
      { examId: 'ex', title: 'T-ex', type: 'exam', event: 'opens', days: 1, reviewInDays: 0, lessonId: 'L', lesson: 'المعادلات' },
      { examId: 'hw', title: 'T-hw', type: 'homework', event: 'closes', days: 9, reviewInDays: 7 },
    ])
  })

  it('caps the plan', () => {
    const exams = Array.from({ length: 12 }, (_, i) => exam({ id: `p${i}`, ends_at: at(i + 1) }))
    expect(buildStudyPlan(input({ exams }))).toHaveLength(NUDGE_LIMITS.planItems)
  })
})
