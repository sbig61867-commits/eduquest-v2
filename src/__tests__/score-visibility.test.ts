import { describe, it, expect } from 'vitest'
import { isAutoGradable, isScoreVisible } from '@/lib/score-visibility'

// The exam list carries has_manual_questions (computed in SQL by
// get_student_exam_list with the same rule as isAutoGradable).

describe('isAutoGradable (the rule has_manual_questions mirrors)', () => {
  it('mcq, true_false and a pre-types question are automatic; written ones are not', () => {
    expect(isAutoGradable({ type: 'mcq' })).toBe(true)
    expect(isAutoGradable({ type: 'true_false' })).toBe(true)
    expect(isAutoGradable({})).toBe(true)
    expect(isAutoGradable({ type: 'essay' })).toBe(false)
    expect(isAutoGradable({ type: 'short_answer' })).toBe(false)
  })
})

describe('isScoreVisible', () => {
  it('hides unpublished homework scores', () => {
    expect(isScoreVisible('pending', 'homework')).toBe(false)
    expect(isScoreVisible('reviewing', 'homework')).toBe(false)
    expect(isScoreVisible('published', 'homework')).toBe(true)
  })

  it('shows regular exam scores on submit, matching /api/exam/submit', () => {
    expect(isScoreVisible('pending', 'exam')).toBe(true)
  })

  it('hides a regular exam with teacher-graded questions until published (audit 2026-09-30)', () => {
    expect(isScoreVisible('pending', 'exam', true)).toBe(false)
    expect(isScoreVisible('published', 'exam', true)).toBe(true)
    expect(isScoreVisible('pending', 'exam', false)).toBe(true)
  })

  it('shows an exam of unknown type only once published', () => {
    expect(isScoreVisible('pending', undefined)).toBe(false)
    expect(isScoreVisible('published', null)).toBe(true)
  })
})
