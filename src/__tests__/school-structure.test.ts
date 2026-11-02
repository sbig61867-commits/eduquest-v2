import { describe, expect, it } from 'vitest'
import {
  SCHOOL_LIMITS, cleanDate, cleanCode, cleanText, isStructureKind, moveInOrder, parseGrade, parseOrder, parsePlacement,
  parseSection, parseStage, parseTerm, parseYear, sectionDisplayName, termFitsYear,
} from '@/lib/school-structure'

// The input rules of /api/school/* (src/lib/school-structure.ts). The database
// enforces the same shapes (neon/migrations/0013_school_structure.sql); these
// give the precise refusal first.

const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`

describe('school structure: field cleaning', () => {
  it('dates must be real calendar days', () => {
    expect(cleanDate('2026-09-01')).toBe('2026-09-01')
    expect(cleanDate('2026-02-30')).toBeNull()
    expect(cleanDate('2026-9-1')).toBeNull()
    expect(cleanDate(20260901)).toBeNull()
  })

  it('text is trimmed, inner spaces collapsed, length bounded', () => {
    expect(cleanText('  Grade   7 ', 120)).toBe('Grade 7')
    expect(cleanText('   ', 120)).toBeNull()
    expect(cleanText('x'.repeat(121), 120)).toBeNull()
    expect(cleanText(7, 120)).toBeNull()
  })

  it('a code may be cleared, too long is invalid', () => {
    expect(cleanCode('')).toBeNull()
    expect(cleanCode(null)).toBeNull()
    expect(cleanCode(' B7 ')).toBe('B7')
    expect(cleanCode('x'.repeat(31))).toBeUndefined()
    expect(cleanCode(5)).toBeUndefined()
  })

  it('structure kinds are a closed list', () => {
    expect(['stage', 'grade', 'section', 'year', 'term'].every(isStructureKind)).toBe(true)
    expect(isStructureKind('group')).toBe(false)
  })
})

describe('school structure: stages and grades', () => {
  it('a stage needs a type from the list and a name', () => {
    expect(parseStage({ stage_kind: 'basic', name: 'Basic' }, 'create')).toEqual({ ok: true, value: { kind: 'basic', name: 'Basic' } })
    expect(parseStage({ stage_kind: 'college', name: 'X' }, 'create')).toEqual({ ok: false, code: 'invalidStageKind' })
    // the body's `kind` names the item, never the stage type
    expect(parseStage({ kind: 'secondary', name: 'X' }, 'create')).toEqual({ ok: false, code: 'invalidStageKind' })
    expect(parseStage({ stage_kind: 'kindergarten', name: ' ' }, 'create')).toEqual({ ok: false, code: 'nameRequired120' })
    expect(parseStage({}, 'update')).toEqual({ ok: false, code: 'nothingToUpdate' })
    expect(parseStage({ code: '' }, 'update')).toEqual({ ok: true, value: { code: null } })
  })

  it('a grade needs its stage; the track is optional and closed', () => {
    expect(parseGrade({ stage_id: id(1), name: 'Grade 10', track: 'scientific' }, 'create'))
      .toEqual({ ok: true, value: { stage_id: id(1), name: 'Grade 10', track: 'scientific' } })
    expect(parseGrade({ stage_id: 'x', name: 'G' }, 'create')).toEqual({ ok: false, code: 'stageNotFound' })
    expect(parseGrade({ stage_id: id(1), name: 'G', track: 'arts' }, 'create')).toEqual({ ok: false, code: 'invalidTrack' })
    expect(parseGrade({ track: null }, 'update')).toEqual({ ok: true, value: { track: null } })
    // the stage is never re-assigned by an edit
    expect(parseGrade({ stage_id: id(2) }, 'update')).toEqual({ ok: false, code: 'nothingToUpdate' })
  })
})

describe('school structure: sections', () => {
  it('a section needs a grade, a year and a label; homeroom, shift and capacity are optional', () => {
    expect(parseSection({ grade_id: id(1), year_id: id(2), label: 'A' }, 'create'))
      .toEqual({ ok: true, value: { grade_id: id(1), year_id: id(2), label: 'A' } })
    expect(parseSection({ grade_id: id(1), year_id: id(2), label: 'A', shift: 'evening', capacity: 30, teacher_id: id(3) }, 'create').ok).toBe(true)
    expect(parseSection({ grade_id: id(1), label: 'A' }, 'create')).toEqual({ ok: false, code: 'yearNotFound' })
    expect(parseSection({ grade_id: id(1), year_id: id(2), label: 'x'.repeat(21) }, 'create')).toEqual({ ok: false, code: 'sectionLabelInvalid' })
    expect(parseSection({ grade_id: id(1), year_id: id(2), label: 'A', shift: 'night' }, 'create')).toEqual({ ok: false, code: 'invalidShift' })
    for (const capacity of [0, -1, 2.5, 501, '30']) {
      expect(parseSection({ grade_id: id(1), year_id: id(2), label: 'A', capacity }, 'create')).toEqual({ ok: false, code: 'groupMaxStudentsInvalid' })
    }
    expect(parseSection({ grade_id: id(1), year_id: id(2), label: 'A', teacher_id: 'nope' }, 'create')).toEqual({ ok: false, code: 'teacherNotInTenant' })
  })

  it('an edit may clear the homeroom teacher, capacity and shift, and archive/restore; never move the year', () => {
    expect(parseSection({ teacher_id: null, capacity: null, shift: '' }, 'update'))
      .toEqual({ ok: true, value: { teacher_id: null, capacity: null, shift: null } })
    expect(parseSection({ is_active: false }, 'update')).toEqual({ ok: true, value: { is_active: false } })
    expect(parseSection({ is_active: 'no' }, 'update')).toEqual({ ok: false, code: 'invalidData' })
    expect(parseSection({ year_id: id(9), grade_id: id(8) }, 'update')).toEqual({ ok: false, code: 'nothingToUpdate' })
  })

  it('the section name every group surface shows is «<grade> <label>»', () => {
    expect(sectionDisplayName(' الصف السابع ', ' أ ')).toBe('الصف السابع أ')
    expect(sectionDisplayName('x'.repeat(250), 'A')).toHaveLength(200)
  })
})

describe('school structure: years and terms', () => {
  it('a year has a name and an end after its start', () => {
    expect(parseYear({ name: '2026/2027', starts_on: '2026-09-01', ends_on: '2027-06-30', is_active: true }, 'create'))
      .toEqual({ ok: true, value: { name: '2026/2027', starts_on: '2026-09-01', ends_on: '2027-06-30', is_active: true } })
    expect(parseYear({ name: 'Y', starts_on: '2027-06-30', ends_on: '2026-09-01' }, 'create')).toEqual({ ok: false, code: 'endBeforeStart' })
    expect(parseYear({ name: '', starts_on: '2026-09-01', ends_on: '2027-06-30' }, 'create')).toEqual({ ok: false, code: 'yearNameInvalid' })
    expect(parseYear({ is_active: true }, 'update')).toEqual({ ok: true, value: { is_active: true } })
  })

  it('a term is numbered 1..4 inside its year', () => {
    const base = { year_id: id(1), term_no: 1, name: 'First term', starts_on: '2026-09-01', ends_on: '2027-01-20' }
    expect(parseTerm(base, 'create').ok).toBe(true)
    expect(parseTerm({ ...base, term_no: 5 }, 'create')).toEqual({ ok: false, code: 'termNumberInvalid' })
    expect(parseTerm({ ...base, term_no: 0 }, 'create')).toEqual({ ok: false, code: 'termNumberInvalid' })
    expect(parseTerm({ ...base, year_id: undefined }, 'create')).toEqual({ ok: false, code: 'yearNotFound' })
    expect(SCHOOL_LIMITS.termsPerYear).toBe(4)
    const year = { starts_on: '2026-09-01', ends_on: '2027-06-30' }
    expect(termFitsYear(base, year)).toBe(true)
    expect(termFitsYear({ starts_on: '2026-08-31', ends_on: '2027-01-20' }, year)).toBe(false)
    expect(termFitsYear({ starts_on: '2027-02-01', ends_on: '2027-07-01' }, year)).toBe(false)
  })
})

describe('school structure: order and placement', () => {
  it('an order is a list of distinct ids within the bound', () => {
    expect(parseOrder([id(1), id(2)], 50)).toEqual({ ok: true, value: [id(1), id(2)] })
    expect(parseOrder([id(1), id(1)], 50)).toEqual({ ok: false, code: 'invalidOrder' })
    expect(parseOrder([], 50)).toEqual({ ok: false, code: 'invalidOrder' })
    expect(parseOrder([id(1), 'x'], 50)).toEqual({ ok: false, code: 'invalidOrder' })
    expect(parseOrder(Array.from({ length: 51 }, (_, k) => id(k)), 50)).toEqual({ ok: false, code: 'invalidOrder' })
  })

  it('moving one step swaps neighbours, never past an edge', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveInOrder(['a', 'b'], 'a', -1)).toBeNull()
    expect(moveInOrder(['a', 'b'], 'b', 1)).toBeNull()
    expect(moveInOrder(['a'], 'z', 1)).toBeNull()
  })

  it('a placement is one section and 1..100 distinct students', () => {
    expect(parsePlacement({ section_id: id(1), student_ids: [id(2), id(2), id(3)] }))
      .toEqual({ ok: true, value: { section_id: id(1), student_ids: [id(2), id(3)] } })
    expect(parsePlacement({ section_id: 'x', student_ids: [id(2)] })).toEqual({ ok: false, code: 'sectionNotFound' })
    expect(parsePlacement({ section_id: id(1), student_ids: [] })).toEqual({ ok: false, code: 'invalidData' })
    expect(parsePlacement({ section_id: id(1), student_ids: ['nope'] })).toEqual({ ok: false, code: 'studentNotInTenant' })
    expect(parsePlacement({ section_id: id(1), student_ids: Array.from({ length: 101 }, (_, k) => id(k)) }))
      .toEqual({ ok: false, code: 'tooManyStudentsSelected' })
  })
})
