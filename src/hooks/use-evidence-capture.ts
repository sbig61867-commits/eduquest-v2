'use client'

import { useCallback, useRef } from 'react'

// Captures a SINGLE evidence snapshot on SEVERE violations only — never
// periodically, never with any AI. Enforces client-side cooldown + max
// (the server re-enforces the max as source of truth). No video is stored.
//
// Severity rules (agreed with the owner):
//   • phone / suspicious object   → capture immediately
//   • another person (multi-face) → capture immediately
//   • fullscreen exit             → capture immediately (first time)
//   • face absent (sustained)     → capture after ~2 consecutive detections (~8s)
//   • tab switch (repeated)       → capture on the 3rd occurrence

const MAX_EVIDENCE = 10          // per student per exam (mirrors server cap)
const COOLDOWN_MS = 20_000       // spread evidence across the exam
const FACE_ABSENT_WINDOW_MS = 6_000
const CANVAS_W = 320
const CANVAS_H = 240

export function useEvidenceCapture(
  examId: string,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
) {
  const capturedRef = useRef(0)
  const lastCaptureRef = useRef(0)
  const faceStreakRef = useRef(0)
  const lastFaceAbsentRef = useRef(0)
  const tabSwitchRef = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const doCapture = useCallback(async (type: string) => {
    const now = Date.now()
    if (capturedRef.current >= MAX_EVIDENCE) return
    if (now - lastCaptureRef.current < COOLDOWN_MS) return
    const video = videoRef.current
    if (!video || video.readyState < 2 || video.videoWidth === 0) return

    // Reserve the slot up-front so rapid events don't all pass the guard.
    lastCaptureRef.current = now
    capturedRef.current += 1

    try {
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
      const canvas = canvasRef.current
      canvas.width = CANVAS_W; canvas.height = CANVAS_H
      const ctx = canvas.getContext('2d')
      if (!ctx) { capturedRef.current -= 1; return }
      ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H)
      const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1]
      if (!base64) { capturedRef.current -= 1; return }

      const res = await fetch('/api/proctor/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId, type, imageBase64: base64 }),
        keepalive: true,
      })
      // If the server rejected (e.g. limit reached), roll back our local counter
      // so the guard stays honest.
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (!data.stored) capturedRef.current -= 1
      } else {
        capturedRef.current -= 1
      }
    } catch {
      capturedRef.current -= 1 // network failure — don't burn the budget
    }
  }, [examId, videoRef])

  // Called on every violation; decides whether it's severe enough for a snapshot.
  const onViolation = useCallback((type: string) => {
    if (!active) return
    const now = Date.now()

    switch (type) {
      case 'suspicious_activity':   // phone / book / laptop
      case 'multiple_faces':        // another person
      case 'fullscreen_exit':       // immediate on first exit
        doCapture(type)
        break

      case 'face_not_detected': {
        // Sustained absence: count consecutive detections within a short window.
        faceStreakRef.current = (now - lastFaceAbsentRef.current < FACE_ABSENT_WINDOW_MS)
          ? faceStreakRef.current + 1 : 1
        lastFaceAbsentRef.current = now
        if (faceStreakRef.current >= 2) { doCapture(type); faceStreakRef.current = 0 }
        break
      }

      case 'tab_switch': {
        tabSwitchRef.current += 1
        if (tabSwitchRef.current >= 3) { doCapture(type); tabSwitchRef.current = 0 }
        break
      }
      // looking_away, audio_detected → not severe, no evidence.
    }
  }, [active, doCapture])

  return { onViolation }
}
