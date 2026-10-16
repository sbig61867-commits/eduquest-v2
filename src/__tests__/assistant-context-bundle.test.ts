import { describe, it, expect } from 'vitest'
import { buildAssistantContext } from '@/lib/assistant/context-bundle'

// The bundle is what the model sees. These tests check the composed output,
// not each policy alone: nothing hidden may appear in the serialised result.

const lessonWithQuiz = [
  '## اختبر نفسك',
  '1. ما لون الكلوروفيل؟',
  'A) أحمر',
  'B) أخضر',
  '**Answer:** B',
  '',
  'Chlorophyll absorbs light for photosynthesis.',
].join('\n')

const examRow = {
  id: 'exam-1',
  title: 'Midterm',
  type: 'exam',
  duration_minutes: 60,
  question_count: 2,
  total_points: 10,
  is_published: true,
}

describe('buildAssistantContext — safe composition', () => {
  it('returns sanitized lesson text and allowlisted exam metadata, in order', () => {
    const r = buildAssistantContext([
      { kind: 'lesson', content: lessonWithQuiz },
      { kind: 'exam', row: examRow },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items.map(i => i.kind)).toEqual(['lesson', 'exam'])
    const lesson = r.items[0]
    expect(lesson.kind === 'lesson' && lesson.text).toContain('ما لون الكلوروفيل؟')
    expect(lesson.kind === 'lesson' && lesson.text).toContain('Chlorophyll absorbs light')
  })

  it('leaves no answer text in the serialised bundle', () => {
    const r = buildAssistantContext([{ kind: 'lesson', content: lessonWithQuiz }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const serialised = JSON.stringify(r.items)
    expect(serialised).not.toMatch(/Answer/i)
    expect(serialised).not.toContain('**Answer')
    expect(serialised).not.toContain('**Answer:** B')
  })

  it('an empty list yields an empty bundle', () => {
    expect(buildAssistantContext([])).toEqual({ ok: true, items: [] })
  })
})

describe('buildAssistantContext — fail closed for the whole bundle', () => {
  it('refuses everything when an exam row carries questions, even with a clean lesson before it', () => {
    const r = buildAssistantContext([
      { kind: 'lesson', content: lessonWithQuiz },
      { kind: 'exam', row: { ...examRow, questions: [{ text: 'Q?', correct_answer: 'B' }] } },
    ])
    expect(r).toEqual({ ok: false, reason: 'forbidden_exam_key', index: 1 })
    expect(r).not.toHaveProperty('items')
  })

  it('refuses when an exam row carries a correct answer at the top level', () => {
    const r = buildAssistantContext([{ kind: 'exam', row: { ...examRow, correct_answer: 'B' } }])
    expect(r).toEqual({ ok: false, reason: 'forbidden_exam_key', index: 0 })
  })

  it('refuses when an allowlisted exam field hides an object with an answer', () => {
    const r = buildAssistantContext([{ kind: 'exam', row: { ...examRow, title: { correct_answer: 'B' } } }])
    expect(r).toEqual({ ok: false, reason: 'unsupported_exam_value', index: 0 })
  })

  it('refuses when a lesson carries an unsupported answer marker', () => {
    const r = buildAssistantContext([
      { kind: 'exam', row: examRow },
      { kind: 'lesson', content: 'Problem 1: x+1=3\nSolution: x=2' },
    ])
    expect(r).toEqual({ ok: false, reason: 'unsupported_answer_marker', index: 1 })
  })

  it('reports the index of the first refused source only', () => {
    const r = buildAssistantContext([
      { kind: 'lesson', content: 'Solution: 4' },
      { kind: 'exam', row: { questions: [] } },
    ])
    expect(r).toEqual({ ok: false, reason: 'unsupported_answer_marker', index: 0 })
  })
})
