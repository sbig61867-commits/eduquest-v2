import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { StudentExam } from '@/lib/data/student-exams'

// The student's phone granted camera + microphone, yet the exam refused to start
// with "camera and microphone permission is required": the full-screen request
// that followed the permission prompt was refused (its user gesture had expired)
// and that refusal was reported as a camera failure.

const toastError = vi.fn()
const recordEvent = vi.fn()

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))
vi.mock('@/components/ui/toast', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }))
vi.mock('@/hooks/use-face-detection', () => ({ useFaceDetection: () => {} }))
vi.mock('@/hooks/use-object-detection', () => ({ useObjectDetection: () => {} }))
vi.mock('@/hooks/use-live-publish', () => ({ useLivePublish: () => {} }))
vi.mock('@/hooks/use-exam-live-channel', () => ({ useExamLiveChannel: () => ({ watched: false, stopWatching: () => {} }) }))
vi.mock('@/hooks/use-evidence-capture', () => ({ useEvidenceCapture: () => ({ onViolation: () => {} }) }))
vi.mock('@/hooks/use-proctor-recorder', () => ({
  useProctorRecorder: () => ({ record: recordEvent, flush: async () => {} }),
}))

import { ExamTaker } from '@/app/(student)/student/exams/exam-taker'

const exam = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Proctored quiz',
  type: 'exam',
  duration_minutes: 10,
  proctoring_enabled: true,
  question_count: 1,
} as unknown as StudentExam
// The questions arrive with the start response (Batch 1), not with the exam.
const served = [{ id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], points: 1 }]

const originalRequestFullscreen = document.documentElement.requestFullscreen

let stream: MediaStream

function stubCamera() {
  stream = { getTracks: () => [] } as unknown as MediaStream
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
  // jsdom has no Web Audio; the audio monitor only needs these calls to exist.
  vi.stubGlobal('AudioContext', class {
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 8, getByteFrequencyData() {} } }
    createMediaStreamSource() { return { connect() {} } }
    close() { return Promise.resolve() }
  })
}

async function startTheExam() {
  render(<ExamTaker exam={exam} userId="u1" tenantId="t1" onFinish={() => {}} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'start' }))
}

describe('starting a proctored exam when full screen is unavailable', () => {
  beforeEach(() => {
    toastError.mockReset()
    recordEvent.mockReset()
    stubCamera()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ startedAt: new Date().toISOString(), resumed: false, questions: served }), { status: 200 })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.requestFullscreen = originalRequestFullscreen
  })

  it('starts the exam when the browser refuses full screen after the permission prompt', async () => {
    document.documentElement.requestFullscreen = vi.fn().mockRejectedValue(new TypeError('Permissions check failed'))
    await startTheExam()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/exam/start', expect.anything()))
    expect(toastError).not.toHaveBeenCalledWith('mediaPermission')
    await screen.findByText('Two plus two')
  })

  it('starts the exam on a phone with no element full screen, and tells the teacher once', async () => {
    // iPhone Safari: requestFullscreen does not exist on elements.
    document.documentElement.requestFullscreen = undefined as unknown as typeof originalRequestFullscreen
    await startTheExam()
    await screen.findByText('Two plus two')
    expect(toastError).not.toHaveBeenCalledWith('mediaPermission')
    await waitFor(() => expect(recordEvent).toHaveBeenCalledWith('detector_unavailable', 'fullscreen: not supported on this device'))
    expect(recordEvent.mock.calls.filter(c => c[0] === 'detector_unavailable')).toHaveLength(1)
  })

  it('attaches the camera stream to the <video> the detectors and snapshots read', async () => {
    // The element mounts only with the exam screen; the stream used to be set
    // on it before it existed, so every camera-based detector read nothing.
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    await startTheExam()
    await screen.findByText('Two plus two')
    const video = document.querySelector('video') as HTMLVideoElement
    expect(video).not.toBeNull()
    await waitFor(() => expect(video.srcObject).toBe(stream))
    expect(video.hasAttribute('playsinline')).toBe(true)
  })

  it('still blocks the exam when the camera permission is really denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
    })
    await startTheExam()
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('mediaPermission'))
    expect(fetch).not.toHaveBeenCalled()
  })
})
