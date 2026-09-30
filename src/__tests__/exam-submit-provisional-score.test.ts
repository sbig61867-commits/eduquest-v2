/**
 * Exam logic audit 2026-09-30 — B3: a regular exam with manually graded
 * questions hands the student a provisional score as final.
 *
 * /api/exam/submit publishes every non-homework result at once
 * (`published = exam.type !== 'homework'`). finalize_exam_submission scores
 * only exact matches, so essay answers count 0 (or full marks when the essay's
 * stored answer is empty — see supabase/tests/exam_grading_check.sql). The
 * teacher grades essays afterwards in the results screen, but the student has
 * already been shown the automatic number as their mark.
 *
 * Expected: while an exam has essay / short-answer questions, the response
 * withholds the score (published: false), exactly as homework does.
 * This test FAILS until the route stops publishing provisional scores.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/exam-roster', () => ({ isOnExamRoster: async () => true }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'student-1' } } }) } }),
}))

const exam = {
  id: 'exam-1', type: 'exam', is_published: true, auto_publish: true,
  questions: [
    { id: 'q1', type: 'mcq', options: ['A', 'B'], correct_answer: 'A', points: 2 },
    { id: 'q2', type: 'essay', correct_answer: '', points: 5 },
  ],
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: () => q, eq: () => q, update: () => q,
        single: async () => ({ data: exam }),
        then: (res: (v: unknown) => void) => res({ error: null }),
      }
      return q
    },
    rpc: async () => ({ data: { score: 2, max_score: 7 }, error: null }),
  }),
}))

import { POST } from '@/app/api/exam/submit/route'

describe('B3 — a regular exam with essays does not publish its automatic score', () => {
  it('withholds the provisional score from the student', async () => {
    const res = await POST(new Request('http://localhost/api/exam/submit', {
      method: 'POST',
      body: JSON.stringify({ examId: 'exam-1', answers: { q1: 'A', q2: 'my essay' } }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.published).toBe(false)
    expect(body.score).toBeUndefined()
  })
})
