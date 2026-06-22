'use client'

/**
 * Server-side proctoring hook — captures frames from the student's camera
 * and sends them to /api/proctor/analyze (Gemini Vision) every 30 seconds.
 *
 * Completely isolated from the legacy client-side detection hooks.
 * Controlled by NEXT_PUBLIC_SERVER_PROCTORING env flag.
 *
 * Returns flushAsync() — call it before submit to:
 *   1. Await any in-flight request (prevents race condition on handleSubmit)
 *   2. Trigger one final capture (closes the last ~30s blind window)
 */

import { useEffect, useRef, useCallback } from 'react'

type OnServerViolation = (types: string[], description: string) => void

export interface ServerProctoringControls {
  /** Trigger a final capture and wait for the server to write to DB. */
  flushAsync: () => Promise<void>
}

const CAPTURE_INTERVAL_MS = 30_000
const CANVAS_WIDTH = 320
const CANVAS_HEIGHT = 240
const ENABLED = process.env.NEXT_PUBLIC_SERVER_PROCTORING === 'true'

export function useServerProctoring(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  examId: string,
  active: boolean,
  onViolation: OnServerViolation
): ServerProctoringControls {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingRef = useRef(false)
  // Set to true by flushAsync — blocks all new captures after submit is initiated
  const stoppedRef = useRef(false)
  // Tracks the in-flight fetch promise so flushAsync can await completion
  const inflightRef = useRef<Promise<void>>(Promise.resolve())

  const captureAndAnalyze = useCallback((): Promise<void> => {
    if (stoppedRef.current) return Promise.resolve()
    if (pendingRef.current) {
      // Already running — return the current in-flight promise so callers can await it
      return inflightRef.current
    }
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) {
      return Promise.resolve()
    }

    pendingRef.current = true
    const work = (async () => {
      try {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width = CANVAS_WIDTH
        canvas.height = CANVAS_HEIGHT
        ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

        const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
        const base64 = dataUrl.split(',')[1]
        if (!base64) return

        const res = await fetch('/api/proctor/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId, frameBase64: base64 }),
        })

        if (!res.ok) return

        const data = await res.json()
        if (Array.isArray(data.issues) && data.issues.length > 0) {
          onViolation(data.issues, data.description ?? '')
        }
      } catch {
        // Silent — network errors must not interrupt the exam
      } finally {
        pendingRef.current = false
      }
    })()

    inflightRef.current = work
    return work
  }, [videoRef, canvasRef, examId, onViolation])

  /**
   * Awaits any in-flight server request, then sends one final frame.
   * Call this in handleSubmit BEFORE reading proctoring_events from DB.
   * This eliminates both the race condition and the last-window blind spot.
   */
  const flushAsync = useCallback(async (): Promise<void> => {
    if (!ENABLED) return
    // Block all future interval ticks immediately — prevents post-submit writes
    stoppedRef.current = true
    // Also stop the interval so it doesn't fire between now and component unmount
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    // Wait for any in-flight request that was already running
    await inflightRef.current
    // Send one final frame to cover the tail of the exam
    // stoppedRef is true here, so we bypass it directly
    stoppedRef.current = false
    await captureAndAnalyze()
    stoppedRef.current = true
  }, [captureAndAnalyze])

  useEffect(() => {
    if (!ENABLED || !active || !examId) return

    // First capture after 10s (give camera time to stabilize)
    const firstCapture = setTimeout(() => {
      captureAndAnalyze()
      intervalRef.current = setInterval(() => { captureAndAnalyze() }, CAPTURE_INTERVAL_MS)
    }, 10_000)

    return () => {
      clearTimeout(firstCapture)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      pendingRef.current = false
    }
  }, [active, examId, captureAndAnalyze])

  return { flushAsync }
}
