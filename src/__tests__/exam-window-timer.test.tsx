/**
 * Exam logic audit 2026-09-30 — B2: the countdown ignores the exam window.
 *
 * finalize_exam_submission refuses any hand-in after exams.ends_at
 * (EXAM_CLOSED), even for a student who started before it and still has
 * duration left. The exam page counts down duration_minutes only, so a
 * student who starts a 60-minute exam 5 minutes before the window closes sees
 * 60:00, keeps working, and at the close every submit fails ("submitFailed")
 * — the attempt stays in_progress and is never graded.
 *
 * Expected: the countdown is min(duration left, time until ends_at).
 * This test FAILS until the timer honours ends_at.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { StudentExam } from '@/lib/data/student-exams'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))
vi.mock('@/components/ui/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/hooks/use-face-detection', () => ({ useFaceDetection: () => {} }))
vi.mock('@/hooks/use-object-detection', () => ({ useObjectDetection: () => {} }))
vi.mock('@/hooks/use-live-publish', () => ({ useLivePublish: () => {} }))
vi.mock('@/hooks/use-exam-live-channel', () => ({ useExamLiveChannel: () => ({ watched: false, stopWatching: () => {} }) }))
vi.mock('@/hooks/use-evidence-capture', () => ({ useEvidenceCapture: () => ({ onViolation: () => {} }) }))
vi.mock('@/hooks/use-proctor-recorder', () => ({ useProctorRecorder: () => ({ record: vi.fn(), flush: async () => {} }) }))

import { ExamTaker } from '@/app/(student)/student/exams/exam-taker'

const toSeconds = (mmss: string) => { const [m, s] = mmss.split(':').map(Number); return m * 60 + s }

describe('B2 — the countdown honours the exam window (ends_at)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        startedAt: new Date().toISOString(), resumed: false,
        // The questions arrive with the start response (Batch 1).
        questions: [{ id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], points: 1 }],
      }), { status: 200 }),
    ))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a 60-minute exam started 5 minutes before the window closes shows at most 5 minutes', async () => {
    const exam = {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Late start',
      type: 'exam',
      duration_minutes: 60,
      proctoring_enabled: false,
      ends_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      question_count: 1,
    } as unknown as StudentExam

    render(<ExamTaker exam={exam} userId="u1" tenantId="t1" onFinish={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    await screen.findByText('Two plus two')

    const clock = await waitFor(() => screen.getByText(/^\d{2}:\d{2}$/))
    expect(toSeconds(clock.textContent ?? '')).toBeLessThanOrEqual(5 * 60)
  })
})
