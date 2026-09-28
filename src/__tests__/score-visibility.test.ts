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

  it('shows an exam of unknown type only once published', () => {
    expect(isScoreVisible('pending', undefined)).toBe(false)
    expect(isScoreVisible('published', null)).toBe(true)
  })
})
