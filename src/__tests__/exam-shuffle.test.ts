import { describe, it, expect } from 'vitest'
import { orderForStudent, prng, seedFrom, shuffled, shouldShuffle } from '@/lib/exam-shuffle'
import type { Question } from '@/types'

const questions: Question[] = Array.from({ length: 12 }, (_, i) => ({
  id: `q${i}`,
  text: `Question ${i}`,
  type: i % 3 === 0 ? 'true_false' : i % 3 === 1 ? 'mcq' : 'short_answer',
  options: i % 3 === 1 ? ['A', 'B', 'C', 'D'] : undefined,
  correct_answer: i % 3 === 1 ? 'C' : 'True',
  points: 1,
}))

describe('exam shuffle', () => {
  it('is deterministic for the same exam and student', () => {
    expect(orderForStudent(questions, 'e1', 's1')).toEqual(orderForStudent(questions, 'e1', 's1'))
  })

  it('gives different students different orders', () => {
    const a = orderForStudent(questions, 'e1', 's1').map(q => q.id).join()
    const b = orderForStudent(questions, 'e1', 's2').map(q => q.id).join()
    expect(a).not.toBe(b)
  })

  it('keeps every question and every option exactly once, and never touches the answer key', () => {
    const out = orderForStudent(questions, 'e1', 's1')
    expect(out.map(q => q.id).sort()).toEqual(questions.map(q => q.id).sort())
    for (const q of out) {
      const original = questions.find(o => o.id === q.id)!
      expect(q.correct_answer).toBe(original.correct_answer)
      if (q.options) expect([...q.options].sort()).toEqual([...original.options!].sort())
    }
  })

  it('does not mutate the teacher’s question list', () => {
    const copy = JSON.parse(JSON.stringify(questions))
    orderForStudent(questions, 'e1', 's1')
    expect(questions).toEqual(copy)
  })

  it('leaves true/false options in their natural order', () => {
    const tf: Question = { id: 't', text: 'x', type: 'true_false', options: ['True', 'False'], correct_answer: 'True', points: 1 }
    for (let s = 0; s < 20; s++) expect(orderForStudent([tf], 'e', `s${s}`)[0].options).toEqual(['True', 'False'])
  })

  it('actually reorders multiple-choice options across students', () => {
    const seen = new Set<string>()
    for (let s = 0; s < 30; s++) seen.add(orderForStudent(questions, 'e1', `s${s}`).find(q => q.id === 'q1')!.options!.join())
    expect(seen.size).toBeGreaterThan(5)
  })

  it('is roughly uniform (no position bias)', () => {
    const firsts = new Map<string, number>()
    const random = prng(seedFrom('uniformity'))
    for (let i = 0; i < 4000; i++) {
      const f = shuffled(['a', 'b', 'c', 'd'], random)[0]
      firsts.set(f, (firsts.get(f) ?? 0) + 1)
    }
    for (const n of firsts.values()) expect(n).toBeGreaterThan(850)
  })

  it('does not shuffle homework', () => {
    expect(shouldShuffle({ type: 'homework' })).toBe(false)
    expect(shouldShuffle({ type: 'exam' })).toBe(true)
    expect(shouldShuffle({})).toBe(true)
  })
})
