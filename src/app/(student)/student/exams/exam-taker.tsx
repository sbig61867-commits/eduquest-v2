'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { ShieldCheck, AlertTriangle, Clock, ChevronLeft, ChevronRight, Send, Eye, Mic } from 'lucide-react'
import type { Exam, Question, ProctoringEvent } from '@/types'
import { useFaceDetection } from '@/hooks/use-face-detection'
import { useObjectDetection } from '@/hooks/use-object-detection'
import { useServerProctoring } from '@/hooks/use-server-proctoring'
import { useLivePublish } from '@/hooks/use-live-publish'
import { useProctorRecorder } from '@/hooks/use-proctor-recorder'
import { useEvidenceCapture } from '@/hooks/use-evidence-capture'

interface Props {
  exam: Exam
  userId: string
  tenantId: string
  violationWarningThreshold?: number
  onFinish: () => void
}

// tenantId remains in Props for the caller's contract, but identity is
// now derived server-side (from the session) in /api/exam/start and /submit.
// userId is used locally only to namespace the answer-draft autosave key.
export function ExamTaker({ exam, userId, violationWarningThreshold = 5, onFinish }: Props) {
  // Homework is untimed: no countdown, no auto-submit — only the due date
  // (ends_at, enforced server-side) limits it. The student exam feed RPC
  // doesn't expose `type`, so homework is recognized by its sentinel
  // duration (43200 = 30 days; legacy rows used 0).
  const untimed = exam.type === 'homework' || exam.duration_minutes <= 0 || exam.duration_minutes >= 43200
  const [started, setStarted] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState(0)
  const [timeLeft, setTimeLeft] = useState(exam.duration_minutes * 60)
  const [violations, setViolations] = useState<ProctoringEvent[]>([])
  const [violationAlert, setViolationAlert] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [finalScore, setFinalScore] = useState<{ score: number; maxScore: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyzerRef = useRef<AnalyserNode | null>(null)
  const audioIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const handleSubmitRef = useRef<() => void>(() => {})
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'active' | 'error'>('idle')

  const proctoringActive = started && exam.proctoring_enabled && cameraStatus === 'active'

  // ── Answer draft autosave (localStorage only — survives refresh/crash on
  //    the same device/browser; not synced server-side). Namespaced per
  //    exam+student so a shared device doesn't leak drafts across accounts. ──
  const draftKey = `examDraft:${exam.id}:${userId}`

  // Restore a saved draft once the attempt actually starts. Called imperatively
  // from startExam() (a user action, not a synchronization) rather than an
  // effect on `started` — a one-time read tied to that click, not a value
  // React needs to keep in sync with anything.
  function restoreDraft() {
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') {
          setAnswers(prev => ({ ...parsed, ...prev }))
        }
      }
    } catch {
      // Private-browsing/quota errors — draft restore is best-effort only.
    }
  }

  // Debounced autosave of in-progress answers, so a crash/refresh doesn't
  // wipe answered questions (answers otherwise live only in React state).
  useEffect(() => {
    if (!started || submitted) return
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(answers))
      } catch {
        // Best-effort — never block the exam on a storage failure.
      }
    }, 500)
    return () => clearTimeout(timeout)
  }, [answers, started, submitted, draftKey])

  // ── Event recorder: persists local detections to the DB, batched + deduped,
  //    with ZERO AI. This is the new primary record path (replaces the Gemini
  //    frame layer, which is now disabled behind NEXT_PUBLIC_SERVER_PROCTORING). ──
  const { record: recordEvent, flush: flushEvents } = useProctorRecorder(exam.id, proctoringActive)

  // ── Evidence capture: one snapshot on SEVERE violations only (no AI, no
  //    periodic capture, capped + cooldown, private bucket). ──
  const { onViolation: maybeCaptureEvidence } = useEvidenceCapture(exam.id, videoRef, proctoringActive)

  // Define addViolation BEFORE hook calls that reference it. It updates the UI
  // alert, buffers the event for the DB recorder, and asks the evidence layer
  // whether this violation is severe enough to snapshot.
  const addViolation = useCallback((type: string, details?: string) => {
    const event: ProctoringEvent = { type: type as ProctoringEvent['type'], timestamp: new Date().toISOString(), details }
    setViolations(prev => [...prev, event])
    recordEvent(type, details)
    maybeCaptureEvidence(type)
    const messages: Record<string, string> = {
      tab_switch: '⚠️ Tab switch detected!',
      fullscreen_exit: '⚠️ Please return to fullscreen mode!',
      face_not_detected: '⚠️ Face not detected — look at the camera!',
      multiple_faces: '⚠️ Multiple faces detected!',
      audio_detected: '⚠️ Loud audio detected!',
      looking_away: '⚠️ Please look at the screen!',
      suspicious_activity: '⚠️ Suspicious activity detected!',
    }
    setViolationAlert(messages[type] ?? '⚠️ Proctoring alert!')
    setTimeout(() => setViolationAlert(''), 4000)
  }, [recordEvent, maybeCaptureEvidence])

  // ── Live layer: publish camera+mic to LiveKit so the teacher watches
  //    in real time (no-ops when LiveKit isn't configured). ──
  useLivePublish(exam.id, proctoringActive)

  // ── Local detection layers (in-browser, no API) — now the PRIMARY monitors ──
  // MediaPipe: face detection + gaze direction
  useFaceDetection(videoRef, proctoringActive, addViolation)
  // TensorFlow COCO-SSD: phone, book, extra person detection
  useObjectDetection(videoRef, proctoringActive, addViolation)

  // ── Legacy Gemini frame layer — DISABLED behind NEXT_PUBLIC_SERVER_PROCTORING
  //    (kept intact for rollback). Inert while the flag is off: flushAsync no-ops
  //    and no frame is ever sent to /api/proctor/analyze. ──
  const { flushAsync } = useServerProctoring(
    videoRef,
    canvasRef,
    exam.id,
    proctoringActive,
    (types, description) => {
      types.forEach(violationType => addViolation(violationType, `[Server] ${description}`))
    }
  )

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (audioIntervalRef.current) clearInterval(audioIntervalRef.current)
      audioCtxRef.current?.close().catch(() => {})
    }
  }, [])

  // Tab visibility detection
  useEffect(() => {
    if (!started || !exam.proctoring_enabled) return
    const handler = () => { if (document.hidden) addViolation('tab_switch') }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [started, exam.proctoring_enabled, addViolation])

  // Fullscreen enforcement
  useEffect(() => {
    if (!started || !exam.proctoring_enabled) return
    const handler = () => { if (!document.fullscreenElement) addViolation('fullscreen_exit') }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [started, exam.proctoring_enabled, addViolation])

  // Timer — uses ref to avoid stale closure over handleSubmit
  useEffect(() => {
    if (!started || submitted || untimed) return
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { handleSubmitRef.current(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [started, submitted, untimed])

  // Start audio monitoring via Web Audio API.
  // Tuned against false positives: a violation needs GENUINELY loud audio
  // (threshold 48, not 30 — normal typing/breathing/room hum stays below),
  // SUSTAINED across 2 consecutive samples (~4s, so a cough or chair squeak
  // doesn't trigger), and a 20s cooldown so one conversation logs once, not
  // once per 3 seconds.
  const startAudioMonitor = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext()
    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 256
    const src = ctx.createMediaStreamSource(stream)
    src.connect(analyzer)
    audioCtxRef.current = ctx
    analyzerRef.current = analyzer
    const data = new Uint8Array(analyzer.frequencyBinCount)
    const LOUD_THRESHOLD = 48
    const COOLDOWN_MS = 20_000
    let loudStreak = 0
    let lastViolationAt = 0
    audioIntervalRef.current = setInterval(() => {
      analyzer.getByteFrequencyData(data)
      const avg = data.reduce((a, b) => a + b, 0) / data.length
      if (avg > LOUD_THRESHOLD) {
        loudStreak += 1
        const now = Date.now()
        if (loudStreak >= 2 && now - lastViolationAt > COOLDOWN_MS) {
          lastViolationAt = now
          loudStreak = 0
          addViolation('audio_detected', `Sustained audio level: ${Math.round(avg)}`)
        }
      } else {
        loudStreak = 0
      }
    }, 2000)
  }, [addViolation])

  async function startExam() {
    if (exam.proctoring_enabled) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        streamRef.current = stream
        setCameraStatus('active')
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
        startAudioMonitor(stream)
        await document.documentElement.requestFullscreen()
      } catch {
        setCameraStatus('error')
        toast.error('Camera and microphone access are required for this proctored exam.')
        return
      }
    }

    // Register the attempt server-side. The server records the authoritative
    // start time and enforces the window — the client cannot fake either.
    try {
      const res = await fetch('/api/exam/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId: exam.id }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // Stop any camera we just opened and surface the reason
        streamRef.current?.getTracks().forEach(t => t.stop())
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
        setCameraStatus('idle')
        toast.error(data.error ?? 'Could not start the exam.')
        return
      }

      // Resume support: if an attempt was already in progress, compute the real
      // remaining time from the server start timestamp instead of resetting it.
      const { startedAt, resumed } = await res.json()
      if (resumed && startedAt && !untimed) {
        const elapsedSecs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
        const remaining = exam.duration_minutes * 60 - elapsedSecs
        if (remaining <= 0) { handleSubmitRef.current(); return }
        setTimeLeft(remaining)
      }

      restoreDraft()
      setStarted(true)
    } catch {
      // fetch() itself threw (offline/DNS/CORS) rather than resolving with a
      // non-OK response — same cleanup as the !res.ok branch above.
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      setCameraStatus('idle')
      toast.error('Network error. Could not start the exam.')
    }
  }

  async function handleSubmit() {
    if (submitting || submitted) return
    setSubmitting(true)

    // Stop audio monitoring (doesn't affect camera — camera needed for flushAsync)
    if (audioIntervalRef.current) { clearInterval(audioIntervalRef.current); audioIntervalRef.current = null }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }

    // Persist any buffered local proctoring events BEFORE submit — the
    // append RPC only writes while the attempt is 'in_progress'. This is the
    // recorder's final flush (no AI). flushAsync() is the legacy Gemini flush,
    // now a no-op while server proctoring is disabled (kept for rollback).
    await flushEvents()
    await flushAsync()

    // Now safe to stop camera and exit fullscreen
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})

    // The recorder already persisted every local violation (batched + deduped)
    // during the exam, so nothing extra is sent here — avoids double-counting.
    // answers stay in React state until we know the submit succeeded, so a
    // failed attempt here can simply be retried by pressing Submit again —
    // finalize_exam_submission is safe to call more than once before the
    // attempt is actually marked 'submitted'.
    try {
      const res = await fetch('/api/exam/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId: exam.id, answers, clientViolations: [] }),
      })

      if (!res.ok) {
        setSubmitting(false)
        toast.error('Submission failed. Please try again.')
        return
      }

      const data = await res.json()
      // Only show the score when it's final (published). Homework that needs
      // manual grading shows a "pending review" message instead of a
      // misleading auto-score that excludes essay questions.
      setFinalScore(data.published ? { score: data.score, maxScore: data.maxScore } : null)
      try { localStorage.removeItem(draftKey) } catch {}
      setSubmitted(true)
      setSubmitting(false)
    } catch {
      // fetch() itself threw (offline/DNS/CORS) — answers are untouched in
      // state, so the student can just press Submit again once reconnected.
      setSubmitting(false)
      toast.error('Network error. Please try again.')
    }
  }

  // Keep ref in sync so the timer callback always calls the latest version
  useLayoutEffect(() => { handleSubmitRef.current = handleSubmit })

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const question: Question = exam.questions[current]
  const progress = ((current + 1) / exam.questions.length) * 100

  if (submitted) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-20 h-20 rounded-full bg-accent-subtle flex items-center justify-center mx-auto">
            <Send className="w-8 h-8 text-accent" />
          </div>
          <h2 className="text-2xl font-bold text-fg">{untimed ? 'تم تسليم الواجب!' : 'Exam Submitted!'}</h2>
          {finalScore ? (
            <p className="text-fg-secondary">Your score: <span className="text-fg font-bold text-xl">{finalScore.score}/{finalScore.maxScore}</span></p>
          ) : (
            <p className="text-accent text-sm">تم استلام إجاباتك — ستظهر علامتك بعد أن يصحّح المعلم وينشر النتائج.</p>
          )}
          {violations.length > 0 && <p className="text-accent text-sm">{violations.length} proctoring violation(s) recorded</p>}
          <Button onClick={onFinish} className="mt-4">Back to Exams</Button>
        </div>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="max-w-lg w-full bg-surface border border-border rounded-lg p-8 space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-fg mb-2">{exam.title}</h2>
            <p className="text-fg-secondary">
              {exam.questions.length} questions · {untimed
                ? (exam.ends_at ? `واجب — سلّمه قبل ${new Date(exam.ends_at).toLocaleString('ar')}` : 'واجب — بدون وقت محدد')
                : `${exam.duration_minutes} minutes`}
            </p>
          </div>
          <div className="space-y-3">
            {[
              untimed
                ? 'هذا واجب بدون مؤقت — خذ وقتك في الحل.'
                : `You have ${exam.duration_minutes} minutes to complete this exam.`,
              untimed
                ? (exam.ends_at ? `آخر موعد للتسليم: ${new Date(exam.ends_at).toLocaleString('ar')}` : null)
                : 'Once started, the timer cannot be paused.',
              exam.proctoring_enabled ? 'Camera and microphone access required (proctored exam).' : null,
              exam.proctoring_enabled ? 'Tab switching and exiting fullscreen will be recorded.' : null,
              'Make sure you have a stable internet connection.',
            ].filter(Boolean).map((rule, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-fg-secondary">
                <span className="text-accent mt-0.5">•</span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
          {exam.proctoring_enabled && (
            <div className="flex items-center gap-2 bg-accent-subtle border border-accent/20 rounded-lg px-4 py-3">
              <ShieldCheck className="w-5 h-5 text-accent shrink-0" />
              <p className="text-accent-hover text-sm">This exam is proctored. Camera monitoring is active.</p>
            </div>
          )}
          <Button onClick={startExam} className="w-full" size="lg">Start Exam</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <div className="flex items-center justify-between bg-surface border border-border rounded-lg px-5 py-3 sticky top-0 z-10">
        <h2 className="text-fg font-semibold truncate flex-1">{exam.title}</h2>
        <div className="flex items-center gap-3">
          {exam.proctoring_enabled && (
            <div className="flex items-center gap-1.5">
              <Eye className={`w-4 h-4 ${cameraStatus === 'active' ? 'text-accent' : 'text-fg-muted'}`} />
              <Mic className={`w-4 h-4 ${cameraStatus === 'active' ? 'text-accent' : 'text-fg-muted'}`} />
            </div>
          )}
          {violations.length > 0 && (
            <span className="flex items-center gap-1 text-accent text-sm font-medium">
              <AlertTriangle className="w-4 h-4" />{violations.length}
            </span>
          )}
          {!untimed && (
            <span className={`flex items-center gap-1.5 font-mono font-bold text-lg ${timeLeft < 300 ? 'text-red-400' : 'text-fg'}`}>
              <Clock className="w-4 h-4" />{formatTime(timeLeft)}
            </span>
          )}
          {exam.proctoring_enabled && cameraStatus === 'active' && (
            <video ref={videoRef} className="w-20 h-14 rounded-lg object-cover border border-border-strong bg-surface" muted />
          )}
        </div>
      </div>

      {/* Violation alert */}
      {violationAlert && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm font-medium animate-pulse">
          {violationAlert}
        </div>
      )}

      {/* Persistent warning once the violation threshold is reached */}
      {exam.proctoring_enabled && violations.length >= violationWarningThreshold && (
        <div className="bg-red-600/20 border border-red-500 rounded-lg px-4 py-3 flex items-center gap-2 text-red-300 text-sm font-semibold">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {violations.length} proctoring violations recorded. Your teacher will review all of them — further violations may invalidate this exam.
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-3">
        <span className="text-fg-secondary text-sm shrink-0">Q {current + 1} / {exam.questions.length}</span>
        <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-fg-secondary text-sm shrink-0">{Object.keys(answers).length} answered</span>
      </div>

      {/* Question Card */}
      {question && (
        <div className="bg-surface border border-border rounded-lg p-6 space-y-5">
          <div className="flex items-start gap-3">
            <span className="bg-accent text-accent-fg text-sm font-bold px-2.5 py-1 rounded-lg shrink-0">{current + 1}</span>
            <p className="text-fg text-lg leading-relaxed">{question.text}</p>
          </div>

          <div className="space-y-2.5">
            {question.type === 'mcq' && question.options?.map((opt, i) => (
              <label key={i} className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-all ${answers[question.id] === opt ? 'bg-accent-subtle border-accent text-fg' : 'border-border-strong text-fg-secondary hover:border-border-strong hover:bg-surface'}`}>
                <input type="radio" name={question.id} value={opt} checked={answers[question.id] === opt} onChange={() => setAnswers(a => ({ ...a, [question.id]: opt }))} className="sr-only" />
                <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 border-current">
                  {answers[question.id] === opt && <span className="w-3 h-3 rounded-full bg-accent" />}
                </span>
                <span>{opt}</span>
              </label>
            ))}

            {question.type === 'true_false' && ['True', 'False'].map(opt => (
              <label key={opt} className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-all ${answers[question.id] === opt ? 'bg-accent-subtle border-accent text-fg' : 'border-border-strong text-fg-secondary hover:border-border-strong hover:bg-surface'}`}>
                <input type="radio" name={question.id} value={opt} checked={answers[question.id] === opt} onChange={() => setAnswers(a => ({ ...a, [question.id]: opt }))} className="sr-only" />
                <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 border-current">
                  {answers[question.id] === opt && <span className="w-3 h-3 rounded-full bg-accent" />}
                </span>
                <span>{opt}</span>
              </label>
            ))}

            {(question.type === 'short_answer' || question.type === 'essay') && (
              <textarea value={answers[question.id] ?? ''} onChange={e => setAnswers(a => ({ ...a, [question.id]: e.target.value }))} rows={4} className="w-full px-4 py-3 rounded-lg bg-surface border border-border-strong text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent resize-none" placeholder="Type your answer here..." />
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}>
          <ChevronLeft className="w-4 h-4" /> Previous
        </Button>
        <div className="flex gap-1.5 flex-wrap justify-center max-w-xs">
          {exam.questions.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)} className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${i === current ? 'bg-accent text-accent-fg' : answers[exam.questions[i].id] ? 'bg-accent-subtle text-accent border border-accent-border' : 'bg-surface text-fg-secondary hover:bg-canvas'}`}>
              {i + 1}
            </button>
          ))}
        </div>
        {current < exam.questions.length - 1 ? (
          <Button onClick={() => setCurrent(c => c + 1)}>Next <ChevronRight className="w-4 h-4" /></Button>
        ) : (
          <Button variant="primary" onClick={handleSubmit} loading={submitting} className="bg-accent hover:bg-accent-hover">
            <Send className="w-4 h-4" /> Submit
          </Button>
        )}
      </div>
    </div>
  )
}
