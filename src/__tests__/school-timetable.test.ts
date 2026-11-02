import { describe, expect, it } from 'vitest'
import {
  SUBJECT_COLOURS, TIMETABLE_LIMITS, cleanTime, hhmm, isCurriculumKind, lessonNumbers, overlaps, parseCell,
  parseGradeSubject, parsePeriod, parseSubject, parseSubjectTeacher, periodsForShift, teacherClash, weeklyCounts,
  weeklyStatus, type BusyPeriod, type SchoolPeriod,
} from '@/lib/school-timetable'

// The input rules and grid helpers of /api/school/{subjects,periods,timetable}
// (src/lib/school-timetable.ts). The database enforces the same shapes
// (neon/migrations/0014_school_subjects_timetable.sql); these give the precise
// refusal first and drive the soft warnings in the timetable grid.

const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`
const period = (k: number, starts: string, ends: string, extra: Partial<SchoolPeriod> = {}): SchoolPeriod =>
  ({ id: id(k), shift: null, kind: 'lesson', name: null, starts_at: starts, ends_at: ends, ...extra })

describe('school timetable: field cleaning', () => {
  it('times are HH:MM, seconds dropped, out-of-range refused', () => {
    expect(cleanTime('08:00')).toBe('08:00')
    expect(cleanTime(' 07:45:30 ')).toBe('07:45')
    expect(cleanTime('24:00')).toBeNull()
    expect(cleanTime('8:00')).toBeNull()
    expect(cleanTime(800)).toBeNull()
    expect(hhmm('08:15:00')).toBe('08:15')
  })

  it('curriculum kinds are a closed list', () => {
    expect(isCurriculumKind('subject')).toBe(true)
    expect(isCurriculumKind('gradeSubject')).toBe(true)
    expect(isCurriculumKind('stage')).toBe(false)
  })
})

describe('school timetable: subjects', () => {
  it('a subject needs a name and a code; the colour is a palette NAME, never a hex', () => {
    expect(parseSubject({ name: ' Mathematics ', code: ' MATH ' }, 'create')).toEqual({ ok: true, value: { name: 'Mathematics', code: 'MATH' } })
    expect(parseSubject({ name: '', code: 'M' }, 'create')).toEqual({ ok: false, code: 'nameRequired120' })
    expect(parseSubject({ name: 'Maths' }, 'create')).toEqual({ ok: false, code: 'subjectCodeRequired' })
    expect(parseSubject({ name: 'Maths', code: 'x'.repeat(31) }, 'create')).toEqual({ ok: false, code: 'codeTooLong' })
    expect(parseSubject({ name: 'Maths', code: 'M', colour: '#ff0000' }, 'create')).toEqual({ ok: false, code: 'invalidColour' })
    expect(parseSubject({ name: 'Maths', code: 'M', colour: 'blue' }, 'create')).toEqual({ ok: false, code: 'invalidColour' })
    for (const c of SUBJECT_COLOURS) expect(parseSubject({ name: 'M', code: 'M', colour: c }, 'create').ok).toBe(true)
    expect(parseSubject({ colour: '' }, 'update')).toEqual({ ok: true, value: { colour: null } })
    expect(parseSubject({}, 'update')).toEqual({ ok: false, code: 'nothingToUpdate' })
  })

  it('a grade link carries 0..40 weekly sessions; 0 / empty means "not taught here"', () => {
    expect(parseGradeSubject({ grade_id: id(1), subject_id: id(2), weekly_sessions: 5 }))
      .toEqual({ ok: true, value: { grade_id: id(1), subject_id: id(2), weekly_sessions: 5 } })
    expect(parseGradeSubject({ grade_id: id(1), subject_id: id(2), weekly_sessions: '' })).toMatchObject({ ok: true, value: { weekly_sessions: 0 } })
    expect(parseGradeSubject({ grade_id: id(1), subject_id: id(2), weekly_sessions: TIMETABLE_LIMITS.weeklySessionsMax + 1 }))
      .toEqual({ ok: false, code: 'weeklySessionsInvalid' })
    expect(parseGradeSubject({ grade_id: id(1), subject_id: id(2), weekly_sessions: 2.5 })).toEqual({ ok: false, code: 'weeklySessionsInvalid' })
    expect(parseGradeSubject({ grade_id: 'x', subject_id: id(2), weekly_sessions: 1 })).toEqual({ ok: false, code: 'gradeNotFound' })
    expect(parseGradeSubject({ grade_id: id(1), subject_id: 'x', weekly_sessions: 1 })).toEqual({ ok: false, code: 'subjectNotFound' })
  })
})

describe('school timetable: bell schedule', () => {
  it('a period is a lesson by default, with a start before its end', () => {
    expect(parsePeriod({ starts_at: '08:00', ends_at: '08:45' }, 'create'))
      .toEqual({ ok: true, value: { kind: 'lesson', shift: null, starts_at: '08:00', ends_at: '08:45' } })
    expect(parsePeriod({ period_kind: 'break', shift: 'morning', name: ' Long break ', starts_at: '10:00', ends_at: '10:20' }, 'create'))
      .toEqual({ ok: true, value: { kind: 'break', shift: 'morning', name: 'Long break', starts_at: '10:00', ends_at: '10:20' } })
    expect(parsePeriod({ starts_at: '09:00', ends_at: '08:00' }, 'create')).toEqual({ ok: false, code: 'endTimeBeforeStart' })
    expect(parsePeriod({ starts_at: 'nine', ends_at: '10:00' }, 'create')).toEqual({ ok: false, code: 'invalidStartTime' })
    expect(parsePeriod({ period_kind: 'lunch', starts_at: '08:00', ends_at: '09:00' }, 'create')).toEqual({ ok: false, code: 'periodKindInvalid' })
    expect(parsePeriod({ shift: 'night', starts_at: '08:00', ends_at: '09:00' }, 'create')).toEqual({ ok: false, code: 'invalidShift' })
    expect(parsePeriod({ name: '' }, 'update')).toEqual({ ok: true, value: { name: null } })
    expect(parsePeriod({}, 'update')).toEqual({ ok: false, code: 'nothingToUpdate' })
  })

  it('a section follows its shift’s bell when the school defined one, else the general bell', () => {
    const general = [period(2, '09:00', '09:45'), period(1, '08:00', '08:45')]
    const morning = [period(3, '07:30', '08:15', { shift: 'morning' })]
    const all = [...general, ...morning]
    expect(periodsForShift(all, null).map(p => p.id)).toEqual([id(1), id(2)])
    expect(periodsForShift(all, 'morning').map(p => p.id)).toEqual([id(3)])
    expect(periodsForShift(all, 'evening').map(p => p.id)).toEqual([id(1), id(2)])
  })

  it('lessons are numbered in time order, breaks are not counted', () => {
    const list = [period(1, '08:00', '08:45'), period(2, '08:45', '09:00', { kind: 'break' }), period(3, '09:00', '09:45')]
    const n = lessonNumbers(list)
    expect([n.get(id(1)), n.get(id(2)), n.get(id(3))]).toEqual([1, undefined, 2])
  })

  it('overlap is half-open: back-to-back periods do not overlap', () => {
    expect(overlaps({ starts_at: '08:00', ends_at: '08:45' }, { starts_at: '08:45:00', ends_at: '09:30:00' })).toBe(false)
    expect(overlaps({ starts_at: '08:00', ends_at: '08:46' }, { starts_at: '08:45', ends_at: '09:30' })).toBe(true)
  })
})

describe('school timetable: cells, teachers, weekly counts, clashes', () => {
  it('a cell needs a section, a day 0–6, a period and (unless cleared) a subject', () => {
    expect(parseCell({ section_id: id(1), day: 0, period_id: id(2), subject_id: id(3) }, false))
      .toEqual({ ok: true, value: { section_id: id(1), day: 0, period_id: id(2), subject_id: id(3) } })
    expect(parseCell({ section_id: id(1), day: 7, period_id: id(2), subject_id: id(3) }, false)).toEqual({ ok: false, code: 'invalidDay' })
    expect(parseCell({ section_id: id(1), day: '1', period_id: id(2), subject_id: id(3) }, false)).toEqual({ ok: false, code: 'invalidDay' })
    expect(parseCell({ section_id: id(1), day: 1, period_id: id(2) }, false)).toEqual({ ok: false, code: 'subjectNotFound' })
    expect(parseCell({ section_id: id(1), day: 1, period_id: id(2) }, true)).toMatchObject({ ok: true, value: { subject_id: null } })
    expect(parseCell({ section_id: 'x', day: 1, period_id: id(2) }, true)).toEqual({ ok: false, code: 'sectionNotFound' })
  })

  it('a subject teacher is a teacher id, or null to remove', () => {
    expect(parseSubjectTeacher({ section_id: id(1), subject_id: id(2), teacher_id: id(3) })).toMatchObject({ ok: true, value: { teacher_id: id(3) } })
    expect(parseSubjectTeacher({ section_id: id(1), subject_id: id(2), teacher_id: null })).toMatchObject({ ok: true, value: { teacher_id: null } })
    expect(parseSubjectTeacher({ section_id: id(1), subject_id: id(2), teacher_id: 'nope' })).toEqual({ ok: false, code: 'teacherNotInTenant' })
  })

  it('weekly counts per subject, and the soft target status', () => {
    const counts = weeklyCounts([{ subject_id: 'm' }, { subject_id: 'm' }, { subject_id: 'a' }])
    expect([counts.get('m'), counts.get('a'), counts.get('x')]).toEqual([2, 1, undefined])
    expect([weeklyStatus(1, 2), weeklyStatus(2, 2), weeklyStatus(3, 2)]).toEqual(['under', 'met', 'over'])
  })

  it('a teacher clash is another section at an overlapping time on the same day', () => {
    const busy: BusyPeriod[] = [{ teacher_id: 't', day: 1, starts_at: '08:00:00', ends_at: '08:45:00', section_id: 's2', section_name: '7B' }]
    const p = { starts_at: '08:00', ends_at: '08:45' }
    expect(teacherClash(busy, 't', 1, p, 's1')?.section_name).toBe('7B')
    expect(teacherClash(busy, 't', 2, p, 's1')).toBeNull()
    expect(teacherClash(busy, 'u', 1, p, 's1')).toBeNull()
    expect(teacherClash(busy, null, 1, p, 's1')).toBeNull()
    expect(teacherClash(busy, 't', 1, { starts_at: '08:45', ends_at: '09:30' }, 's1')).toBeNull()
  })
})
