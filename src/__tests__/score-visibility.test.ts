import { describe, it, expect } from 'vitest'
import { isScoreVisible } from '@/lib/score-visibility'
import { metaFromLegacyRow } from '@/lib/data/student-exams'

// The exam list no longer carries questions (Batch 1): visibility reads the
// list's has_manual_questions, computed from the questions with isAutoGradable.
const manual = (questions: Array<{ type?: string }>) =>
  metaFromLegacyRow({ questions } as unknown as Parameters<typeof metaFromLegacyRow>[0]).has_manual_questions

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
    const essayExam = manual([{ type: 'mcq' }, { type: 'essay' }])
    expect(essayExam).toBe(true)
    expect(isScoreVisible('pending', 'exam', essayExam)).toBe(false)
    expect(isScoreVisible('published', 'exam', essayExam)).toBe(true)
    expect(isScoreVisible('pending', 'exam', manual([{ type: 'mcq' }, { type: 'true_false' }]))).toBe(true)
    expect(isScoreVisible('pending', 'exam', manual([{ type: 'short_answer' }]))).toBe(false)
    // A pre-types question (no type) is auto-graded, as in the DB grader.
    expect(isScoreVisible('pending', 'exam', manual([{}]))).toBe(true)
  })

  it('shows an exam of unknown type only once published', () => {
    expect(isScoreVisible('pending', undefined)).toBe(false)
    expect(isScoreVisible('published', null)).toBe(true)
  })
})
