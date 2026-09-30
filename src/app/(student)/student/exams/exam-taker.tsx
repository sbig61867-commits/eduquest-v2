'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { ShieldCheck, AlertTriangle, Clock, ChevronLeft, ChevronRight, Send, Eye, Mic, Monitor, Camera, Trash2, MessageSquareText } from 'lucide-react'
import { DOCUMENT_PHOTO, prepareImageForUpload } from '@/lib/prepare-image'
import type { Exam, Question, ProctoringEvent } from '@/types'
import { useFaceDetection } from '@/hooks/use-face-detection'
import { useObjectDetection } from '@/hooks/use-object-detection'
import { useLivePublish } from '@/hooks/use-live-publish'
import { useProctorRecorder } from '@/hooks/use-proctor-recorder'
import { useEvidenceCapture } from '@/hooks/use-evidence-capture'
import { useExamLiveChannel } from '@/hooks/use-exam-live-channel'
import { canRequestFullscreen, enterFullscreen } from '@/lib/fullscreen'
import { orderForStudent, shouldShuffle } from '@/lib/exam-shuffle'
import { formatMonitoringSummary } from '@/lib/proctoring-events'
import { environmentFlags, readEnvironmentFacts } from '@/lib/device-environment'
import { useMonitoringCoverage } from '@/hooks/use-monitoring-coverage'
import { useFaceIdentity } from '@/hooks/use-face-identity'
import { useClipRecorder } from '@/hooks/use-clip-recorder'
import { useThumbnailSender } from '@/hooks/use-thumbnail-sender'
import { SecondCameraPanel } from '@/components/student/second-camera-panel'
import { readSebProof } from '@/lib/seb-client'
import { SpeechDetector } from '@/lib/speech-detector'

interface Props {
  exam: Exam
  userId: string
  tenantId: string
  violationWarningThreshold?: number
  onFinish: () => void
  /** Label of the button on the result screen (defaults to "back to exams"). */
  finishLabel?: string
}

// tenantId remains in Props for the caller's contract, but identity is
// now derived server-side (from the session) in /api/exam/start and /submit.
// userId is used locally only to namespace the answer-draft autosave key.
// Canonical submitted values, never translated: correct_answer is stored as
// 'True'/'False' and graded in the DB, so only the visible label changes.
const TRUE_FALSE_VALUES = ['True', 'False'] as const

// The room scan lasts one clip segment.
const ROOM_SCAN_MS = 10_000
const FACE_TYPES = new Set(['face_not_detected', 'looking_away', 'multiple_faces', 'face_mismatch', 'spoof_detected'])

// More characters than this appearing in one input event, without a paste,
// means text was dropped or injected rather than typed.
const BULK_INSERT_CHARS = 60

export function ExamTaker({ exam, userId, violationWarningThreshold = 5, onFinish, finishLabel }: Props) {
  const t = useTranslations('student.taker')
  const locale = useLocale()
  // Homework is untimed: no countdown, no auto-submit — only the due date
  // (ends_at, enforced server-side) limits it. `type` is authoritative
  // whenever the feed supplies it (student_exams_expose_type_migration.sql);
  // the duration sentinel (43200 = 30 days; legacy rows used 0) is only a
  // fallback for feeds that predate it. Trusting the sentinel on a row that
  // does carry a `type` would strip the timer off a real exam whose teacher
  // happened to save a 0 or >= 43200 duration.
  const untimed = exam.type
    ? exam.type === 'homework'
    : (exam.duration_minutes <= 0 || exam.duration_minutes >= 43200)
  // Per-student order of questions and multiple-choice options (display only;
  // answers stay keyed by question id and option text — src/lib/exam-shuffle.ts).
  const questions = useMemo(
    () => (shouldShuffle(exam) ? orderForStudent(exam.questions, exam.id, userId) : exam.questions),
    [exam, userId],
  )
  const [started, setStarted] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState(0)
  const [timeLeft, setTimeLeft] = useState(exam.duration_minutes * 60)
  const [violations, setViolations] = useState<ProctoringEvent[]>([])
  const [violationAlert, setViolationAlert] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [finalScore, setFinalScore] = useState<{ score: number; maxScore: number } | null>(null)
  // Individual follow-up tasks: a photo of the handwritten answer per written
  // question (signed URLs; the files themselves live in private storage).
  const [answerFiles, setAnswerFiles] = useState<Record<string, string>>({})
  const individual = !!exam.assigned_student_id
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyzerRef = useRef<AnalyserNode | null>(null)
  const audioIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const handleSubmitRef = useRef<() => void>(() => {})
  const submittingRef = useRef(false)
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'active' | 'error'>('idle')
  const [consentGiven, setConsentGiven] = useState(false)
  // Full screen could not be entered when the exam started (see enterFullscreen):
  // 'retry' on the next tap, or 'unsupported' on a device without it.
  const [fullscreenGap, setFullscreenGap] = useState<'none' | 'retry' | 'unsupported'>('none')
  const fullscreenGapReportedRef = useRef(false)

  const proctoringActive = started && exam.proctoring_enabled && cameraStatus === 'active'

  // ── Answer draft autosave ──
  // localStorage: survives refresh/crash on the same device (all exam types).
  // Server draft: survives device switch for timed exams only (homework has no
  // time pressure and no risk of losing answers mid-session).
  const draftKey = `examDraft:${exam.id}:${userId}`

  // Restore draft on exam start. Server draft (returned by /api/exam/start on
  // resume) takes priority for timed exams; localStorage fills the rest.
  function restoreDraft(serverDraft?: Record<string, string>) {
    try {
      const saved = localStorage.getItem(draftKey)
      const local: Record<string, string> = saved ? JSON.parse(saved) : {}
      const merged = { ...local, ...(serverDraft ?? {}) }
      if (Object.keys(merged).length > 0) {
        setAnswers(prev => ({ ...merged, ...prev }))
      }
    } catch {
      // Best-effort — never block the exam on a storage failure.
      if (serverDraft && Object.keys(serverDraft).length > 0) {
        setAnswers(prev => ({ ...serverDraft, ...prev }))
      }
    }
  }

  // Debounced localStorage autosave (all exam types).
  useEffect(() => {
    if (!started || submitted) return
    const timeout = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify(answers)) } catch {}
    }, 500)
    return () => clearTimeout(timeout)
  }, [answers, started, submitted, draftKey])

  // Server-side draft sync every 60 s (timed exams only — excludes homework),
  // and only when the answers changed since the last save: an idle student
  // costs the database nothing. The interval does not restart on every
  // keystroke (it reads the answers through a ref), so a student who keeps
  // typing is still saved once a minute.
  const answersRef = useRef(answers)
  useEffect(() => { answersRef.current = answers }, [answers])
  const savedDraftRef = useRef('{}')
  useEffect(() => {
    if (!started || submitted || untimed) return
    const id = setInterval(async () => {
      const draft = JSON.stringify(answersRef.current)
      if (draft === savedDraftRef.current) return
      try {
        const res = await fetch('/api/exam/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId: exam.id, answers: answersRef.current }),
        })
        if (res.ok) savedDraftRef.current = draft
      } catch {
        // Network hiccup — next interval will retry.
      }
    }, 60_000)
    return () => clearInterval(id)
  }, [started, submitted, untimed, exam.id])

  // ── Event recorder: persists local detections to the DB, batched + deduped,
  //    with ZERO AI. The only proctoring data that reaches the server is these
  //    compact event records (plus capped evidence snapshots below). ──
  const { record: recordEvent, flush: flushEvents } = useProctorRecorder(exam.id, proctoringActive)

  // ── Evidence capture: one snapshot on SEVERE violations only (no AI, no
  //    periodic capture, capped + cooldown, private bucket). ──
  const [evidenceStored, setEvidenceStored] = useState(0)
  const onEvidenceStored = useCallback(() => setEvidenceStored(n => n + 1), [])
  const { onViolation: maybeCaptureEvidence } = useEvidenceCapture(exam.id, videoRef, proctoringActive, onEvidenceStored)
  // Short evidence clips from an in-memory ring of 10 s segments (never
  // uploaded unless a severe violation happens or the teacher asks).
  const { onViolation: clipOnViolation, sendRecent: sendRecentClips, requestRoomScan } = useClipRecorder(exam.id, streamRef, proctoringActive, onEvidenceStored)

  // ── Room scan: for the first seconds the student turns the camera slowly
  //    around the room; that first clip segment is kept as evidence. The face
  //    naturally leaves the frame meanwhile, so face checks are paused. ──
  const [roomScanning, setRoomScanning] = useState(false)
  const roomScanUntilRef = useRef(0)
  useEffect(() => {
    if (!proctoringActive) return
    roomScanUntilRef.current = Date.now() + ROOM_SCAN_MS
    requestRoomScan()
    const on = setTimeout(() => setRoomScanning(true), 0)
    const off = setTimeout(() => setRoomScanning(false), ROOM_SCAN_MS)
    return () => { clearTimeout(on); clearTimeout(off) }
  }, [proctoringActive, requestRoomScan])

  // Define addViolation BEFORE hook calls that reference it. It updates the UI
  // alert, buffers the event for the DB recorder, and asks the evidence layer
  // whether this violation is severe enough to snapshot.
  const addViolation = useCallback((type: string, details?: string) => {
    // The camera is pointed around the room on purpose during the scan.
    if (Date.now() < roomScanUntilRef.current && FACE_TYPES.has(type)) return
    const event: ProctoringEvent = { type: type as ProctoringEvent['type'], timestamp: new Date().toISOString(), details }
    setViolations(prev => [...prev, event])
    recordEvent(type, details)
    maybeCaptureEvidence(type)
    clipOnViolation(type)
    const messages: Record<string, string> = {
      tab_switch: '⚠️ Tab switch detected!',
      fullscreen_exit: '⚠️ Please return to fullscreen mode!',
      face_not_detected: '⚠️ Face not detected — look at the camera!',
      camera_stopped: '⚠️ Camera/microphone disconnected — please reconnect immediately!',
      multiple_faces: '⚠️ Multiple faces detected!',
      audio_detected: '⚠️ Loud audio detected!',
      speech_detected: '⚠️ Talking detected!',
      face_mismatch: '⚠️ Please stay in front of the camera yourself!',
      spoof_detected: '⚠️ Show your real face to the camera!',
      looking_away: '⚠️ Please look at the screen!',
      suspicious_activity: '⚠️ Suspicious activity detected!',
    }
    setViolationAlert(messages[type] ?? '⚠️ Proctoring alert!')
    setTimeout(() => setViolationAlert(''), 4000)
  }, [recordEvent, maybeCaptureEvidence, clipOnViolation])

  // ── Writing signals (not violations): pasted text and a large block of text
  //    appearing at once in a written answer. In the age of AI chat tools
  //    these are among the strongest hints a teacher can get, and they cost
  //    nothing. Silent: the student sees no warning. The question number is
  //    the teacher's own (original) numbering, not the shuffled one. ──
  const lastPasteRef = useRef(0)
  const questionNumber = useCallback(
    (id: string) => exam.questions.findIndex(q => q.id === id) + 1,
    [exam.questions],
  )
  const onWrittenPaste = useCallback((id: string, chars: number) => {
    lastPasteRef.current = Date.now()
    if (chars > 0) recordEvent('paste_detected', `Q${questionNumber(id)}: ${chars} chars`)
  }, [recordEvent, questionNumber])
  const onWrittenChange = useCallback((id: string, value: string) => {
    const grew = value.length - (answersRef.current[id] ?? '').length
    if (grew >= BULK_INSERT_CHARS && Date.now() - lastPasteRef.current > 1_000) {
      recordEvent('bulk_insert', `Q${questionNumber(id)}: +${grew} chars`)
    }
    setAnswers(a => ({ ...a, [id]: value }))
  }, [recordEvent, questionNumber])

  // ── Live layer, on demand and silent: the student joins the exam's live
  //    channel (who is in the exam + violation counts for the teacher, no
  //    table touched) and streams camera+mic to LiveKit ONLY while the teacher
  //    watches this student. Nothing on this screen says whether that is
  //    happening; the consent text says it may happen at any time. ──
  const liveCounts = useMemo(() => ({ v: violations.length, ev: evidenceStored }), [violations.length, evidenceStored])
  const { watched, stopWatching, thumbsOn } = useExamLiveChannel(exam.id, userId, proctoringActive, liveCounts, sendRecentClips)
  // Teacher's thumbnail wall: a tiny picture every few seconds, not while
  // this student is already being watched in video.
  useThumbnailSender(exam.id, userId, videoRef, proctoringActive && thumbsOn && !watched)
  useLivePublish(exam.id, proctoringActive && watched, streamRef, stopWatching)

  // A detector that fails to load on this device is NOT the student's fault,
  // so it is recorded for the teacher (so "no events" is never mistaken for a
  // clean attempt) but not shown as a violation or counted against them.
  const onDetectorUnavailable = useCallback((detector: string, reason: string) => {
    recordEvent('detector_unavailable', `${detector}: ${reason}`)
  }, [recordEvent])

  // ── Proctoring runs ENTIRELY on the student's device ──
  // No camera frame is ever sent to a server or an AI model for analysis: the
  // former Gemini frame layer (/api/proctor/analyze) was removed on
  // 2026-09-13. The server only receives batched event records and, for
  // severe violations, a capped number of evidence snapshots.
  // MediaPipe: face detection + gaze direction
  // ── Monitoring coverage: how much of the attempt the camera detectors
  //    really watched; a stall of 30 s+ is recorded as a monitoring gap. ──
  const onMonitoringGap = useCallback((seconds: number) => {
    recordEvent('monitoring_gap', `no camera analysis for ${seconds}s`)
  }, [recordEvent])
  const coverage = useMonitoringCoverage(proctoringActive, onMonitoringGap)

  // ── Device environment (virtual machine, second screen, automation):
  //    recorded once per attempt as info for the teacher, never a violation. ──
  const environmentReportedRef = useRef(false)
  useEffect(() => {
    if (!proctoringActive || environmentReportedRef.current) return
    environmentReportedRef.current = true
    for (const flag of environmentFlags(readEnvironmentFacts())) recordEvent('environment_flag', flag)
  }, [proctoringActive, recordEvent])

  useFaceDetection(videoRef, proctoringActive, addViolation, onDetectorUnavailable, coverage.onFrame)
  // Identity continuity + photo/screen spoof, capable devices only (Human, MIT).
  useFaceIdentity(videoRef, proctoringActive, addViolation, onDetectorUnavailable)
  // TensorFlow COCO-SSD: phone, book, extra person detection
  useObjectDetection(videoRef, proctoringActive, addViolation, onDetectorUnavailable)

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
    const handler = () => { if (!document.fullscreenElement && !submittingRef.current) addViolation('fullscreen_exit') }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [started, exam.proctoring_enabled, addViolation])

  // ── Camera preview ──
  // Face detection, object detection and evidence snapshots all read frames
  // from this <video>. It only exists once the exam screen renders, so the
  // stream is attached here, not in startExam() (where the element was still
  // missing: the stream was never attached, every camera-based detector read an
  // empty element and skipped it silently, and no snapshot was ever taken).
  // If no frame arrives, the teacher is told instead of seeing a clean attempt.
  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!proctoringActive || !video || !stream) return
    if (video.srcObject !== stream) video.srcObject = stream
    Promise.resolve().then(() => video.play()).catch(() => {})
    const check = setTimeout(() => {
      if (video.readyState < 2) recordEvent('detector_unavailable', 'camera: no video frames reached the detectors')
    }, 10_000)
    return () => clearTimeout(check)
  }, [proctoringActive, recordEvent])

  // Full screen that could not be entered at start: retry on the student's
  // next tap, which carries a fresh user gesture. A device with no element
  // full screen (iPhone) is recorded once for the teacher — not a violation,
  // just a monitoring gap, like a detector that failed to load.
  useEffect(() => {
    if (!proctoringActive || fullscreenGap !== 'unsupported' || fullscreenGapReportedRef.current) return
    fullscreenGapReportedRef.current = true
    recordEvent('detector_unavailable', 'fullscreen: not supported on this device')
  }, [proctoringActive, fullscreenGap, recordEvent])

  useEffect(() => {
    if (!proctoringActive || fullscreenGap !== 'retry') return
    const retry = () => {
      enterFullscreen().then(ok => { if (ok) setFullscreenGap('none') })
    }
    document.addEventListener('pointerdown', retry)
    return () => document.removeEventListener('pointerdown', retry)
  }, [proctoringActive, fullscreenGap])

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

  // Audio monitoring via the Web Audio API, on the device, no download:
  //  • speech (src/lib/speech-detector.ts): voice-band energy with a syllable
  //    rhythm — someone talking, not a fan or a chair;
  //  • very loud sound sustained ~4 s (the former check, kept for noise that
  //    is not speech), with a 20 s cooldown.
  const startAudioMonitor = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext()
    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 1024
    analyzer.smoothingTimeConstant = 0.3
    const src = ctx.createMediaStreamSource(stream)
    src.connect(analyzer)
    audioCtxRef.current = ctx
    analyzerRef.current = analyzer
    const data = new Uint8Array(analyzer.frequencyBinCount)
    const speech = new SpeechDetector({ sampleRate: ctx.sampleRate, binCount: analyzer.frequencyBinCount })
    const LOUD_THRESHOLD = 48
    const LOUD_FRAMES = 40
    const COOLDOWN_MS = 20_000
    let loudStreak = 0
    let lastLoudAt = 0
    audioIntervalRef.current = setInterval(() => {
      analyzer.getByteFrequencyData(data)
      const now = Date.now()
      if (speech.feed(data, now)) addViolation('speech_detected', 'voice with syllable rhythm for 1.5 s+')
      const avg = data.reduce((a, b) => a + b, 0) / data.length
      if (avg > LOUD_THRESHOLD) {
        loudStreak += 1
        if (loudStreak >= LOUD_FRAMES && now - lastLoudAt > COOLDOWN_MS) {
          lastLoudAt = now
          loudStreak = 0
          addViolation('audio_detected', `Sustained audio level: ${Math.round(avg)}`)
        }
      } else {
        loudStreak = 0
      }
    }, 100)
  }, [addViolation])

  async function startExam() {
    // The in-app consent screen (below) must be explicitly checked before
    // this runs for a proctored exam — startExam() is only reachable via its
    // Start button, which stays disabled until consentGiven is true, so this
    // is a defensive re-check, not the primary gate.
    if (exam.proctoring_enabled && !consentGiven) return

    if (exam.proctoring_enabled) {
      let stream: MediaStream
      try {
        // The one capture for the whole exam: the detectors, the evidence
        // snapshots and the live stream to the teacher all share it.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            // Front camera: phones default to the rear one.
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        })
      } catch {
        setCameraStatus('error')
        toast.error(t('mediaPermission'))
        return
      }
      streamRef.current = stream
      // The <video> the detectors read only mounts with the exam screen, after
      // `started` — the effect "Camera preview" attaches the stream to it then.
      setCameraStatus('active')
      startAudioMonitor(stream)
      // A track can stop mid-exam (device unplugged, OS-level camera kill,
      // permission revoked from the browser's own UI) without the app ever
      // calling stop() itself — that's a real monitoring gap the proctor
      // must see, not a silent camera-status flip.
      stream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
          setCameraStatus('error')
          addViolation('camera_stopped', `${track.kind} track ended unexpectedly`)
        })
      })
      // Best-effort; a refusal is retried on the student's next tap (below).
      if (!(await enterFullscreen())) setFullscreenGap(canRequestFullscreen() ? 'retry' : 'unsupported')
    }

    // Register the attempt server-side. The server records the authoritative
    // start time and enforces the window — the client cannot fake either.
    try {
      const res = await fetch('/api/exam/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Safe Exam Browser's proof, when the page runs inside SEB (else null).
        body: JSON.stringify({ examId: exam.id, seb: await readSebProof() }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // Stop any camera we just opened and surface the reason
        streamRef.current?.getTracks().forEach(t => t.stop())
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
        setCameraStatus('idle')
        toast.error(data.error ?? t('startFailed'))
        return
      }

      // Resume support: compute real remaining time + restore server draft.
      const { startedAt, resumed, answers_draft, answer_files } = await res.json()
      if (answer_files && typeof answer_files === 'object') setAnswerFiles(answer_files)
      if (!untimed) {
        // The attempt ends at whichever comes first: its own duration (from the
        // server's start time, so a resume keeps counting) or the exam window
        // closing — the server refuses a hand-in after ends_at, so a countdown
        // past it would end in a lost attempt (exam logic audit 2026-09-30).
        const start = startedAt ? new Date(startedAt).getTime() : Date.now()
        const deadlines = [start + exam.duration_minutes * 60_000]
        if (exam.ends_at) deadlines.push(new Date(exam.ends_at).getTime())
        const remaining = Math.floor((Math.min(...deadlines) - Date.now()) / 1000)
        if (remaining <= 0) { handleSubmitRef.current(); return }
        setTimeLeft(remaining)
      }

      restoreDraft(resumed && !untimed ? (answers_draft ?? {}) : undefined)
      setStarted(true)
    } catch {
      // fetch() itself threw (offline/DNS/CORS) rather than resolving with a
      // non-OK response — same cleanup as the !res.ok branch above.
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      setCameraStatus('idle')
      toast.error(t('startNetworkError'))
    }
  }

  async function handleSubmit() {
    if (submitting || submitted) return
    setSubmitting(true)

    // Stop audio monitoring first (camera stays on until events are flushed)
    if (audioIntervalRef.current) { clearInterval(audioIntervalRef.current); audioIntervalRef.current = null }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }

    // Leaving full screen below is part of submitting, not a violation.
    submittingRef.current = true

    // How much of the attempt was actually monitored (written once).
    const monitored = exam.proctoring_enabled ? coverage.summary() : null
    if (monitored) recordEvent('monitoring_summary', formatMonitoringSummary(monitored))

    // Persist any buffered local proctoring events BEFORE submit — the
    // append RPC only writes while the attempt is 'in_progress'. This is the
    // recorder's final flush (no AI).
    await flushEvents()

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
        submittingRef.current = false
        setSubmitting(false)
        toast.error(t('submitFailed'))
        return
      }

      const data = await res.json()
      // Only show the score when it's final (published). Homework that needs
      // manual grading shows a "pending review" message instead of a
      // misleading auto-score that excludes essay questions.
      setFinalScore(data.published ? { score: data.score, maxScore: data.maxScore } : null)
      try { localStorage.removeItem(draftKey) } catch {}
      setSubmitted(true)
      submittingRef.current = false
      setSubmitting(false)
    } catch {
      // fetch() itself threw (offline/DNS/CORS) — answers are untouched in
      // state, so the student can just press Submit again once reconnected.
      submittingRef.current = false
      setSubmitting(false)
      toast.error(t('networkError'))
    }
  }

  // Keep ref in sync so the timer callback always calls the latest version
  useLayoutEffect(() => { handleSubmitRef.current = handleSubmit })

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const question: Question = questions[current]
  const progress = ((current + 1) / questions.length) * 100

  if (submitted) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
            <Send className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">{untimed ? t('doneHomework') : t('doneExam')}</h2>
          {finalScore ? (
            <p className="text-slate-400">{t('yourScore')} <span className="text-white font-bold text-xl">{finalScore.score}/{finalScore.maxScore}</span></p>
          ) : (
            <p className="text-amber-400 text-sm">{t('pendingReview')}</p>
          )}
          {violations.length > 0 && <p className="text-amber-400 text-sm">{t('violationsRecorded', { count: violations.length })}</p>}
          <Button onClick={onFinish} className="mt-4">{finishLabel ?? t('backToExams')}</Button>
        </div>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white mb-2">{exam.title}</h2>
            <p className="text-slate-400">
              {t('questionCount', { count: questions.length })} · {untimed
                ? (exam.ends_at ? t('homeworkDue', { date: new Date(exam.ends_at).toLocaleString(locale) }) : t('homeworkNoDue'))
                : t('minutes', { count: exam.duration_minutes })}
            </p>
          </div>
          <TeacherNote instructions={exam.instructions} urls={exam.attachment_urls} />
          <div className="space-y-3">
            {[
              untimed
                ? t('untimedHint')
                : t('ruleTime', { minutes: t('minutes', { count: exam.duration_minutes }) }),
              untimed
                ? (exam.ends_at ? t('deadline', { date: new Date(exam.ends_at).toLocaleString(locale) }) : null)
                : t('ruleNoPause'),
              exam.proctoring_enabled ? t('ruleCamera') : null,
              exam.proctoring_enabled ? t('ruleTabs') : null,
              t('ruleInternet'),
            ].filter(Boolean).map((rule, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <span className="text-blue-400 mt-0.5">•</span>
                <span>{rule}</span>
              </div>
            ))}
          </div>

          {/* Advisory, not a blocker — a laptop/phone works fine, desktop/tablet
              is just steadier for a proctored session (stable camera framing,
              less battery/thermal throttling during on-device detection). */}
          <div className="flex items-start gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3">
            <Monitor className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-slate-400 text-xs leading-relaxed">
              {t('desktopRecommendation')}
            </p>
          </div>

          {exam.proctoring_enabled && (
            <>
              <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3">
                <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" />
                <p className="text-blue-300 text-sm">{t('proctoredNotice')}</p>
              </div>

              {/* Explicit in-app consent — required before the Start button
                  enables. The browser's own camera-permission prompt is not
                  informed consent on its own: it never explains that
                  detection runs on-device, or that severe violations save an
                  evidence snapshot. */}
              <label className="flex items-start gap-3 bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={e => setConsentGiven(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
                />
                <span className="text-slate-300 text-xs leading-relaxed">
                  {t('consentText')}
                </span>
              </label>
            </>
          )}

          <Button onClick={startExam} className="w-full" size="lg" disabled={exam.proctoring_enabled && !consentGiven}>
            {t('start')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-5 py-3 sticky top-0 z-10">
        <h2 className="text-white font-semibold truncate flex-1">{exam.title}</h2>
        <div className="flex items-center gap-3">
          {exam.proctoring_enabled && (
            <div className="flex items-center gap-1.5">
              <Eye className={`w-4 h-4 ${cameraStatus === 'active' ? 'text-emerald-400' : 'text-slate-500'}`} />
              <Mic className={`w-4 h-4 ${cameraStatus === 'active' ? 'text-emerald-400' : 'text-slate-500'}`} />
            </div>
          )}
          {violations.length > 0 && (
            <span className="flex items-center gap-1 text-amber-400 text-sm font-medium">
              <AlertTriangle className="w-4 h-4" />{violations.length}
            </span>
          )}
          {!untimed && (
            <span className={`flex items-center gap-1.5 font-mono font-bold text-lg ${timeLeft < 300 ? 'text-red-400' : 'text-white'}`}>
              <Clock className="w-4 h-4" />{formatTime(timeLeft)}
            </span>
          )}
          {exam.proctoring_enabled && cameraStatus === 'active' && (
            <video ref={videoRef} className="w-20 h-14 rounded-lg object-cover border border-slate-700 bg-slate-800" muted playsInline autoPlay />
          )}
        </div>
      </div>

      {roomScanning && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3 text-blue-300 text-sm font-medium">
          {t('roomScan')}
        </div>
      )}

      {/* Optional phone side camera (desk + screen) */}
      {exam.proctoring_enabled && cameraStatus === 'active' && <SecondCameraPanel examId={exam.id} />}

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
          {t('violationsWarning', { count: violations.length })}
        </div>
      )}

      {(exam.instructions || (exam.attachment_urls?.length ?? 0) > 0) && (
        <details className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-3">
          <summary className="cursor-pointer text-sm text-slate-300 flex items-center gap-2">
            <MessageSquareText className="w-4 h-4 text-blue-400" />{t('teacherNote')}
          </summary>
          <div className="mt-3"><TeacherNote instructions={exam.instructions} urls={exam.attachment_urls} bare /></div>
        </details>
      )}

      {/* Progress */}
      <div className="flex items-center gap-3">
        <span className="text-slate-400 text-sm shrink-0">{t('questionOf', { n: current + 1, total: questions.length })}</span>
        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-slate-400 text-sm shrink-0">{t('answered', { count: Object.keys(answers).length })}</span>
      </div>

      {/* Question Card */}
      {question && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <span className="bg-blue-600 text-white text-sm font-bold px-2.5 py-1 rounded-lg shrink-0">{current + 1}</span>
            <p className="text-white text-lg leading-relaxed">{question.text}</p>
          </div>

          <div className="space-y-2.5">
            {question.type === 'mcq' && question.options?.map((opt, i) => (
              <label key={i} className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${answers[question.id] === opt ? 'bg-blue-600/20 border-blue-500 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-800'}`}>
                <input type="radio" name={question.id} value={opt} checked={answers[question.id] === opt} onChange={() => setAnswers(a => ({ ...a, [question.id]: opt }))} className="sr-only" />
                <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 border-current">
                  {answers[question.id] === opt && <span className="w-3 h-3 rounded-full bg-blue-400" />}
                </span>
                <span>{opt}</span>
              </label>
            ))}

            {/* The VALUE submitted stays the canonical 'True'/'False' the whole
                codebase stores in correct_answer (AI generators, the teacher
                editor and the in-DB grader all agree on it) — only the LABEL
                is Arabic. Rendering the label as the value would mean the
                student submits the Arabic label against a correct_answer of 'True' and
                every true/false question grades as wrong. */}
            {question.type === 'true_false' && TRUE_FALSE_VALUES.map(value => (
              <label key={value} className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${answers[question.id] === value ? 'bg-blue-600/20 border-blue-500 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-800'}`}>
                <input type="radio" name={question.id} value={value} checked={answers[question.id] === value} onChange={() => setAnswers(a => ({ ...a, [question.id]: value }))} className="sr-only" />
                <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 border-current">
                  {answers[question.id] === value && <span className="w-3 h-3 rounded-full bg-blue-400" />}
                </span>
                <span>{value === 'True' ? t('true') : t('false')}</span>
              </label>
            ))}

            {(question.type === 'short_answer' || question.type === 'essay') && (
              <textarea value={answers[question.id] ?? ''} onChange={e => onWrittenChange(question.id, e.target.value)} onPaste={e => onWrittenPaste(question.id, e.clipboardData.getData('text').length)} rows={4} className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder={t('answerPlaceholder')} />
            )}
            {individual && (question.type === 'short_answer' || question.type === 'essay') && (
              <AnswerPhoto
                examId={exam.id}
                questionId={question.id}
                url={answerFiles[question.id]}
                onChange={url => setAnswerFiles(f => {
                  const next = { ...f }
                  if (url) next[question.id] = url
                  else delete next[question.id]
                  return next
                })}
              />
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}>
          <ChevronLeft className="w-4 h-4" /> {t('prev')}
        </Button>
        <div className="flex gap-1.5 flex-wrap justify-center max-w-xs">
          {questions.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)} className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${i === current ? 'bg-blue-600 text-white' : answers[questions[i].id] ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-600/50' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
              {i + 1}
            </button>
          ))}
        </div>
        {current < questions.length - 1 ? (
          <Button onClick={() => setCurrent(c => c + 1)}>{t('next')} <ChevronRight className="w-4 h-4" /></Button>
        ) : (
          <Button variant="primary" onClick={handleSubmit} loading={submitting} className="bg-emerald-600 hover:bg-emerald-500">
            <Send className="w-4 h-4" /> {t('submit')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** The teacher's note on an individual task: weak points / what to do, plus their images. */
function TeacherNote({ instructions, urls, bare = false }: { instructions?: string | null; urls?: string[]; bare?: boolean }) {
  const t = useTranslations('student.taker')
  const images = urls ?? []
  if (!instructions && images.length === 0) return null
  return (
    <div className={bare ? 'space-y-3' : 'bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-3'}>
      {!bare && (
        <p className="text-blue-300 text-sm font-medium flex items-center gap-2">
          <MessageSquareText className="w-4 h-4" />{t('teacherNote')}
        </p>
      )}
      {instructions && <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">{instructions}</p>}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {images.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-slate-700 bg-slate-800">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
              <img src={url} alt={t('attachmentAlt', { n: i + 1 })} className="w-full h-28 object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A photo of the student's handwritten answer to one written question of an
 * individual task. Shrunk on the device first (prepareImageForUpload), stored
 * privately by /api/exam/answer-file, shown back through a signed URL.
 */
function AnswerPhoto({ examId, questionId, url, onChange }: {
  examId: string; questionId: string; url?: string; onChange: (url: string | null) => void
}) {
  const t = useTranslations('student.taker')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setBusy(true)
    try {
      const ready = await prepareImageForUpload(file, DOCUMENT_PHOTO)
      const fd = new FormData()
      fd.append('examId', examId)
      fd.append('questionId', questionId)
      fd.append('file', ready)
      const res = await fetch('/api/exam/answer-file', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) toast.error(data.error ?? t('photoFailed'))
      else onChange(data.url)
    } catch {
      toast.error(t('photoFailed'))
    }
    setBusy(false)
  }

  async function remove() {
    setBusy(true)
    const res = await fetch('/api/exam/answer-file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ examId, questionId }),
    })
    if (res.ok) onChange(null)
    else toast.error((await res.json().catch(() => ({}))).error ?? t('photoFailed'))
    setBusy(false)
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }}
      />
      {url ? (
        <div className="flex items-start gap-3">
          <a href={url} target="_blank" rel="noopener noreferrer" className="block w-32 h-24 rounded-lg overflow-hidden border border-slate-700 bg-slate-800 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
            <img src={url} alt={t('photoAttached')} className="w-full h-full object-cover" />
          </a>
          <div className="flex flex-col gap-2">
            <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
              <Camera className="w-4 h-4" />{t('replacePhoto')}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove} className="hover:text-red-400">
              <Trash2 className="w-4 h-4" />{t('removePhoto')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
            <Camera className="w-4 h-4" />{t('attachPhoto')}
          </Button>
          <span className="text-slate-500 text-xs">{t('photoHint')}</span>
        </div>
      )}
    </div>
  )
}
