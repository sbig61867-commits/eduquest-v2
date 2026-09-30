import { describe, it, expect } from 'vitest'
import { isScoreVisible } from '@/lib/score-visibility'

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
    const essayExam = [{ type: 'mcq' }, { type: 'essay' }]
    expect(isScoreVisible('pending', 'exam', essayExam)).toBe(false)
    expect(isScoreVisible('published', 'exam', essayExam)).toBe(true)
    expect(isScoreVisible('pending', 'exam', [{ type: 'mcq' }, { type: 'true_false' }])).toBe(true)
    expect(isScoreVisible('pending', 'exam', [{ type: 'short_answer' }])).toBe(false)
  })

  it('shows an exam of unknown type only once published', () => {
    expect(isScoreVisible('pending', undefined)).toBe(false)
    expect(isScoreVisible('published', null)).toBe(true)
  })
})
