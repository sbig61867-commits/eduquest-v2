import { describe, it, expect } from 'vitest'
import { sanitizeLessonForAssistant, pickExamMetaForAssistant, ASSISTANT_EXAM_FIELDS } from '@/lib/assistant/context-policy'

// Realistic answer shapes. Each must leave no answer text in what the model sees.

describe('sanitizeLessonForAssistant — answer lines removed', () => {
  it('drops a bold MCQ answer line and keeps the question and options', () => {
    const src = [
      '## اختبر نفسك',
      '1. ما لون الكلوروفيل؟',
      'A) أحمر',
      'B) أخضر',
      'C) أزرق',
      '**Answer:** B',
    ].join('\n')
    const r = sanitizeLessonForAssistant(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain('ما لون الكلوروفيل؟')
    expect(r.text).toContain('B) أخضر')
    expect(r.text).not.toMatch(/Answer/i)
    expect(r.text).not.toContain('**Answer')
  })

  it('drops a plain true/false answer line', () => {
    const r = sanitizeLessonForAssistant('2. The sun orbits the Earth. (True/False)\nAnswer: False')
    expect(r.ok).toBe(true)
    if (r.ok) {
      // "(True/False)" is part of the prompt; only the answer line must go.
      expect(r.text).toBe('2. The sun orbits the Earth. (True/False)')
      expect(r.text).not.toContain('Answer')
    }
  })

  it('drops a fill-in answer with alternatives separated by a slash', () => {
    const r = sanitizeLessonForAssistant('3. The capital of France is ____.\nAnswer: Paris / باريس')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toContain('The capital of France is ____.')
      expect(r.text).not.toContain('Paris')
      expect(r.text).not.toContain('باريس')
    }
  })

  it('drops an Arabic answer label (الإجابة:)', () => {
    const r = sanitizeLessonForAssistant('٤. ما عاصمة مصر؟\nالإجابة: القاهرة')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toContain('ما عاصمة مصر؟')
      expect(r.text).not.toContain('القاهرة')
    }
  })

  it('drops an inline answer after the question on the same line', () => {
    const r = sanitizeLessonForAssistant('5. What is 2 + 2? Answer: 4')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe('5. What is 2 + 2?')
    }
  })

  it('drops a long essay model answer, including continuation lines up to a blank line', () => {
    const src = [
      '6. Explain photosynthesis in your own words.',
      'Answer: Plants use sunlight to convert water and carbon dioxide',
      'into glucose and oxygen in the chloroplasts.',
      '',
      'Next section text stays.',
    ].join('\n')
    const r = sanitizeLessonForAssistant(src)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toContain('Explain photosynthesis')
      expect(r.text).not.toContain('chloroplasts')
      expect(r.text).toContain('Next section text stays.')
    }
  })

  it('drops a dash-separated answer line (Answer - B, الإجابة – القاهرة)', () => {
    const dash = sanitizeLessonForAssistant('1. Colour?\nAnswer - B\n\nNext.')
    expect(dash.ok).toBe(true)
    if (dash.ok) {
      expect(dash.text).not.toMatch(/Answer/)
      expect(dash.text).toContain('Next.')
    }
    const arDash = sanitizeLessonForAssistant('٢. عاصمة مصر؟\nالإجابة – القاهرة')
    expect(arDash.ok).toBe(true)
    if (arDash.ok) expect(arDash.text).not.toContain('القاهرة')
  })

  it('keeps solved worked examples in content sections (no label, no refusal)', () => {
    const r = sanitizeLessonForAssistant('Example: There ==is== a car in the garage.')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toContain('==is==')
  })
})

describe('sanitizeLessonForAssistant — refusals (fail closed)', () => {
  it('refuses a solution marker it does not interpret', () => {
    const r = sanitizeLessonForAssistant('Problem 1: x+1=3\nSolution: x=2')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unsupported_answer_marker')
  })

  it('refuses an Arabic solution marker (الحل:)', () => {
    const r = sanitizeLessonForAssistant('مسألة: x+1=3\nالحل: x=2')
    expect(r.ok).toBe(false)
  })

  it('refuses an answer-key marker', () => {
    const r = sanitizeLessonForAssistant('Answer key: 1-B, 2-A')
    expect(r.ok).toBe(false)
  })

  it('does not refuse plain prose that mentions the word "answer" without a label', () => {
    const r = sanitizeLessonForAssistant('Students should answer the questions at the end.')
    expect(r.ok).toBe(true)
  })
})

describe('pickExamMetaForAssistant — exam metadata allowlist', () => {
  const row = {
    id: 'e1',
    title: 'Midterm',
    type: 'exam',
    group_name: 'G1',
    course_title: 'Bio',
    starts_at: '2026-10-10T10:00:00Z',
    ends_at: null,
    duration_minutes: 60,
    question_count: 12,
    has_manual_questions: false,
    total_points: 24,
    lesson_id: null,
    is_published: true,
  }

  it('passes allowlisted metadata only', () => {
    const r = pickExamMetaForAssistant(row)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Object.keys(r.value).sort()).toEqual([...ASSISTANT_EXAM_FIELDS].sort())
    }
  })

  it('refuses a row that carries questions', () => {
    const r = pickExamMetaForAssistant({ ...row, questions: [{ text: 'q', correct_answer: 'B' }] })
    expect(r).toEqual({ ok: false, reason: 'forbidden_exam_key' })
  })

  it('refuses a row that carries a correct answer at the top level', () => {
    const r = pickExamMetaForAssistant({ ...row, correct_answer: 'B' })
    expect(r.ok).toBe(false)
  })

  it('refuses rubric and model-answer keys', () => {
    expect(pickExamMetaForAssistant({ ...row, rubric: 'x' }).ok).toBe(false)
    expect(pickExamMetaForAssistant({ ...row, model_answer: 'x' }).ok).toBe(false)
  })

  it('refuses a non-scalar value in an allowlisted field', () => {
    const r = pickExamMetaForAssistant({ ...row, title: { text: 'x' } })
    expect(r).toEqual({ ok: false, reason: 'unsupported_exam_value' })
  })

  it('does not copy fields outside the allowlist', () => {
    const r = pickExamMetaForAssistant({ id: 'e1', teacher_id: 't1', tenant_id: 'x' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ id: 'e1' })
  })
})
