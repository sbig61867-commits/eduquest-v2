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
vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => ({ sub: 'student-1', email: null, role: 'student', tenant_id: '11111111-1111-1111-1111-111111111111', is_active: true, must_change_password: false }),
}))

const EXAM_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
const exam = {
  id: EXAM_ID, type: 'exam', is_published: true, auto_publish: true,
  questions: [
    { id: 'q1', type: 'mcq', options: ['A', 'B'], correct_answer: 'A', points: 2 },
    { id: 'q2', type: 'essay', correct_answer: '', points: 5 },
  ],
}
// The SQL layer: the exam with the roster check, then the finalize call.
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  if (q.text.startsWith('select e.id, e.type')) return [{ ...exam, on_roster: true }]
  if (q.text.startsWith('select public.finalize_exam_submission')) return [{ r: { score: 2, max_score: 7 } }]
  return []
}))

import { POST } from '@/app/api/exam/submit/route'

describe('B3 — a regular exam with essays does not publish its automatic score', () => {
  it('withholds the provisional score from the student', async () => {
    const res = await POST(new Request('http://localhost/api/exam/submit', {
      method: 'POST',
      body: JSON.stringify({ examId: EXAM_ID, answers: { q1: 'A', q2: 'my essay' } }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.published).toBe(false)
    expect(body.score).toBeUndefined()
  })
})
