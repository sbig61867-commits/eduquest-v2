import { describe, it, expect } from 'vitest'
import { buildItems, summarize, summarizeAttendance, type Assessment, type AttendanceMark, type Submission } from '@/lib/teacher-records'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const day = (d: number) => new Date(NOW + d * 86_400_000).toISOString()

const A = (id: string, over: Partial<Assessment> = {}): Assessment => ({
  id, kind: 'exam', title: id, lessonId: null, lessonTitle: null, createdAt: day(-30), endsAt: null, maxPoints: 10, source: 'group', ...over,
})
const S = (examId: string, over: Partial<Submission> = {}): Submission => ({
  id: `s-${examId}`, examId, studentId: 'st', score: null, maxScore: 10, gradingStatus: 'pending',
  status: 'submitted', submittedAt: day(-5), flagged: false, ...over,
})

describe('buildItems — one status per assessment, from real submissions', () => {
  const assessments = [
    A('graded'),
    A('awaiting'),
    A('started'),
    A('missed', { endsAt: day(-2) }),
    A('open', { endsAt: day(3) }),
    A('noDeadline'),
    A('beforeJoin', { endsAt: day(-40) }),   // closed before the student joined → not theirs
  ]
  const subs = [
    S('graded', { score: 8, gradingStatus: 'published' }),
    S('awaiting'),
    S('started', { status: 'in_progress', submittedAt: null }),
  ]
  const items = buildItems(assessments, subs, day(-35), NOW)
  const by = Object.fromEntries(items.map(i => [i.assessment.id, i]))

  it('classifies every case', () => {
    expect(by.graded.status).toBe('graded')
    expect(by.awaiting.status).toBe('awaiting')
    expect(by.started.status).toBe('inProgress')
    expect(by.missed.status).toBe('missed')
    expect(by.open.status).toBe('open')
    expect(by.noDeadline.status).toBe('open')
  })

  it('leaves out an assessment that closed before the student joined', () => {
    expect(by.beforeJoin).toBeUndefined()
  })

  it('computes the percentage only for graded work', () => {
    expect(by.graded.pct).toBe(80)
    expect(by.graded.score).toBe(8)
    expect(by.awaiting.pct).toBeNull()
  })

  it('falls back to the question points when the submission has no max', () => {
    const [item] = buildItems([A('x', { maxPoints: 20 })], [S('x', { score: 15, maxScore: null })], null, NOW)
    expect(item.pct).toBe(75)
  })
})

describe('summarize — the numbers a teacher sees', () => {
  const assessments = [
    A('e1', { createdAt: day(-20) }),
    A('e2', { createdAt: day(-10) }),
    A('h1', { kind: 'homework', createdAt: day(-15) }),
    A('h2', { kind: 'homework', createdAt: day(-8), endsAt: day(-1) }),   // missed
  ]
  const subs = [
    S('e1', { score: 9, submittedAt: day(-19) }),   // 90
    S('e2', { score: 6, submittedAt: day(-9) }),    // 60 — latest graded
    S('h1', { score: 7, submittedAt: day(-14) }),   // 70
  ]
  const marks: AttendanceMark[] = [
    { sessionId: '1', date: day(-3), title: null, status: 'present', note: null },
    { sessionId: '2', date: day(-2), title: null, status: 'late', note: null },
    { sessionId: '3', date: day(-1), title: null, status: 'absent', note: null },
    { sessionId: '4', date: day(0), title: null, status: 'excused', note: null },
    { sessionId: '5', date: day(0), title: null, status: null, note: null },
  ]
  const s = summarize(buildItems(assessments, subs, null, NOW), marks, { done: 3, total: 4 })

  it('averages exams and homework separately and overall', () => {
    expect(s.exams).toEqual({ assigned: 2, submitted: 2, graded: 2, avg: 75 })
    expect(s.homework).toEqual({ assigned: 2, submitted: 1, graded: 1, avg: 70 })
    expect(s.overallAvg).toBe(73)   // (90 + 60 + 70) / 3
  })

  it('counts completion over everything assigned', () => {
    expect(s.completion).toBe(75)   // 3 of 4
  })

  it('excludes excused absences from both sides of the attendance rate', () => {
    expect(s.attendance).toMatchObject({ present: 1, late: 1, absent: 1, excused: 1, unmarked: 1, rate: 67 })
  })

  it('takes the trend from the last two graded items', () => {
    // Latest graded is e2 (60), before it h1 (70): a 10-point drop.
    expect(s.trend).toBe('down')
  })

  it('reports course progress and the latest activity', () => {
    expect(s.progress).toEqual({ done: 3, total: 4, pct: 75 })
    expect(s.lastActivity).toBe(day(-9))
  })

  it('marks at risk only below a 50% average', () => {
    expect(s.atRisk).toBe(false)
    const low = summarize(buildItems([A('x')], [S('x', { score: 4 })], null, NOW), [], null)
    expect(low.atRisk).toBe(true)
  })

  it('gives nothing to average when nothing is graded', () => {
    const empty = summarize([], [], null)
    expect(empty.overallAvg).toBeNull()
    expect(empty.completion).toBeNull()
    expect(empty.trend).toBe('none')
    expect(summarizeAttendance([]).rate).toBeNull()
  })
})
