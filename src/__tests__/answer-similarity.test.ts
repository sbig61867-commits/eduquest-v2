import { describe, it, expect } from 'vitest'
import { findSimilarPairs, jaccard } from '@/lib/answer-similarity'

const qs = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, type: 'mcq', correct_answer: 'A' }))
const essay = { id: 'e1', type: 'essay', correct_answer: null }

function sub(id: string, answers: string[], essayText?: string) {
  const a: Record<string, string> = {}
  answers.forEach((v, i) => { a[`q${i}`] = v })
  if (essayText) a.e1 = essayText
  return { studentId: id, name: id, answers: a }
}

describe('answer similarity', () => {
  it('flags two students who share rare identical wrong answers', () => {
    const subs = [
      sub('s1', ['B', 'C', 'D', 'B', 'A', 'A', 'A', 'A', 'A', 'A']),
      sub('s2', ['B', 'C', 'D', 'B', 'A', 'A', 'A', 'A', 'A', 'A']),
      sub('s3', ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A']),
      sub('s4', ['C', 'A', 'A', 'A', 'A', 'B', 'A', 'A', 'A', 'A']),
    ]
    const pairs = findSimilarPairs(qs, subs)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ a: { studentId: 's1' }, b: { studentId: 's2' }, sameWrong: 4, bothWrong: 4 })
  })

  it('does not flag students who are simply both right', () => {
    const all = Array(10).fill('A')
    expect(findSimilarPairs(qs, [sub('s1', all), sub('s2', all), sub('s3', all)])).toEqual([])
  })

  it('does not flag students who are wrong on the same questions with different choices', () => {
    const subs = [
      sub('s1', ['B', 'B', 'B', 'B', 'A', 'A', 'A', 'A', 'A', 'A']),
      sub('s2', ['C', 'C', 'C', 'C', 'A', 'A', 'A', 'A', 'A', 'A']),
    ]
    expect(findSimilarPairs(qs, subs)).toEqual([])
  })

  it('ranks a rare shared mistake above a mistake the whole class made', () => {
    const common = ['B', 'B', 'B', 'A', 'A', 'A', 'A', 'A', 'A', 'A']
    const subs = [
      sub('c1', common), sub('c2', common), sub('c3', common), sub('c4', common),
      sub('r1', ['D', 'C', 'D', 'A', 'A', 'A', 'A', 'A', 'A', 'A']),
      sub('r2', ['D', 'C', 'D', 'A', 'A', 'A', 'A', 'A', 'A', 'A']),
    ]
    const pairs = findSimilarPairs(qs, subs)
    expect(pairs[0].a.studentId).toBe('r1')
    expect(pairs[0].b.studentId).toBe('r2')
  })

  it('flags nearly identical long written answers', () => {
    const text = 'The mitochondria is the powerhouse of the cell because it produces most of the energy the cell needs'
    const subs = [
      sub('s1', Array(10).fill('A'), text),
      sub('s2', Array(10).fill('A'), text + ' today'),
      sub('s3', Array(10).fill('A'), 'Cells get their energy from many different processes that happen inside them all the time'),
    ]
    const pairs = [...findSimilarPairs([...qs, essay], subs)]
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ sameText: 1, a: { studentId: 's1' }, b: { studentId: 's2' } })
  })

  it('ignores short written answers that are naturally identical', () => {
    const subs = [sub('s1', Array(10).fill('A'), 'Yes'), sub('s2', Array(10).fill('A'), 'Yes')]
    expect(findSimilarPairs([...qs, essay], subs)).toEqual([])
  })

  it('computes jaccard', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0)
    expect(jaccard(new Set(), new Set(['b']))).toBe(0)
  })
})
