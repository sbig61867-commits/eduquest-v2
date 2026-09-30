import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { StudentExam } from '@/lib/data/student-exams'

/**
 * Batch 1: the exam screen receives metadata from the list and the questions
 * from /api/exam/start only. Covers start, resume, a page reload, submit and a
 * refused start, from the student's side of the screen.
 */

const toastError = vi.fn()
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => (vars?.count !== undefined ? `${key}:${vars.count}` : key),
  useLocale: () => 'en',
}))
vi.mock('@/components/ui/toast', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/hooks/use-face-detection', () => ({ useFaceDetection: () => {} }))
vi.mock('@/hooks/use-object-detection', () => ({ useObjectDetection: () => {} }))
vi.mock('@/hooks/use-live-publish', () => ({ useLivePublish: () => {} }))
vi.mock('@/hooks/use-exam-live-channel', () => ({ useExamLiveChannel: () => ({ watched: false, stopWatching: () => {} }) }))
vi.mock('@/hooks/use-evidence-capture', () => ({ useEvidenceCapture: () => ({ onViolation: () => {} }) }))
vi.mock('@/hooks/use-proctor-recorder', () => ({ useProctorRecorder: () => ({ record: vi.fn(), flush: async () => {} }) }))

import { ExamTaker } from '@/app/(student)/student/exams/exam-taker'

// Homework: untimed and not shuffled, so the served order is the screen order.
const exam = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Lesson homework',
  type: 'homework',
  duration_minutes: 43200,
  proctoring_enabled: false,
  ends_at: null,
  question_count: 2,
  has_manual_questions: false,
} as unknown as StudentExam

const served = [
  { id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], points: 1 },
  { id: 'q2', type: 'true_false', text: 'The sky is blue', points: 1 },
]

type Call = { url: string; body: Record<string, unknown> }
let calls: Call[]
let startReply: () => Response

function stubServer() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} })
    if (url === '/api/exam/start') return startReply()
    if (url === '/api/exam/submit') return new Response(JSON.stringify({ published: false }), { status: 200 })
    return new Response('{}', { status: 200 })
  }))
}

const ok = (extra: Record<string, unknown> = {}) => () =>
  new Response(JSON.stringify({ startedAt: new Date().toISOString(), resumed: false, questions: served, ...extra }), { status: 200 })

const renderTaker = () => render(<ExamTaker exam={exam} userId="student-1" tenantId="" onFinish={() => {}} />)

beforeEach(() => {
  toastError.mockReset()
  localStorage.clear()
  startReply = ok()
  stubServer()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('exam screen with metadata-only list rows', () => {
  it('before start: shows the count from the list, no question text, no request yet', () => {
    renderTaker()
    expect(screen.getByText(/questionCount:2/)).toBeTruthy()
    expect(screen.queryByText('Two plus two')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('start: the questions come from /api/exam/start and render', async () => {
    renderTaker()
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    await screen.findByText('Two plus two')
    expect(calls.filter(c => c.url === '/api/exam/start')).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ examId: exam.id })
  })

  it('submit: answers are keyed by question id and sent to /api/exam/submit', async () => {
    renderTaker()
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    await screen.findByText('Two plus two')
    fireEvent.click(screen.getByText('4'))
    fireEvent.click(screen.getByRole('button', { name: /next/ }))
    await screen.findByText('The sky is blue')
    fireEvent.click(screen.getByText('true'))
    fireEvent.click(screen.getByRole('button', { name: /submit/ }))
    await waitFor(() => expect(calls.some(c => c.url === '/api/exam/submit')).toBe(true))
    const submit = calls.find(c => c.url === '/api/exam/submit')!
    expect(submit.body).toMatchObject({ examId: exam.id, answers: { q1: '4', q2: 'True' } })
    await screen.findByText('doneHomework')
  })

  it('resume: the server draft is restored onto the served questions', async () => {
    // Timed exam: the server draft is used on resume (homework uses the local one).
    const timed = { ...exam, type: 'exam', duration_minutes: 30 } as unknown as StudentExam
    startReply = ok({ resumed: true, answers_draft: { q1: '4' } })
    render(<ExamTaker exam={timed} userId="student-1" tenantId="" onFinish={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    // Timed exams are shuffled per student, so either question may come first:
    // the answered counter proves the draft landed on the served questions.
    await screen.findAllByRole('radio')
    expect(screen.getByText('answered:1')).toBeTruthy()
    expect(screen.getByText(/questionOf/)).toBeTruthy()
  })

  it('refresh / reload: a new screen asks the server again and gets the same questions and the saved answers', async () => {
    const first = renderTaker()
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    await screen.findByText('Two plus two')
    fireEvent.click(screen.getByText('4'))
    // The local draft is written 500 ms after the last change.
    await waitFor(() => expect(localStorage.getItem(`examDraft:${exam.id}:student-1`)).toContain('"q1":"4"'), { timeout: 2000 })
    first.unmount()

    startReply = ok({ resumed: true })
    renderTaker()
    expect(screen.queryByText('Two plus two')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    await screen.findByText('Two plus two')
    expect(calls.filter(c => c.url === '/api/exam/start')).toHaveLength(2)
    const checked = screen.getAllByRole('radio').filter(r => (r as HTMLInputElement).checked)
    expect(checked.map(r => (r as HTMLInputElement).value)).toEqual(['4'])
  })

  it('a refused start shows the reason and never renders a question', async () => {
    startReply = () => new Response(JSON.stringify({ error: 'examNotOpen' }), { status: 403 })
    renderTaker()
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('examNotOpen'))
    expect(screen.queryByText('Two plus two')).toBeNull()
    expect(screen.getByRole('button', { name: 'start' })).toBeTruthy()
  })
})
