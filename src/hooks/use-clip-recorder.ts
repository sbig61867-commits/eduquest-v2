'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CLIP_MAX_PER_STUDENT, CLIP_SEGMENT_MS, ON_REQUEST, isEvidenceType } from '@/lib/evidence-keys'
import { RING_SIZE, pickClipMimeType, recentSegments, segmentForViolation, type Segment } from '@/lib/clip-segments'

// Short evidence clips, recorded on the student's device.
//
// While a proctored attempt runs, the exam page's OWN stream (no second
// capture) is recorded in back-to-back 10-second segments at a low bitrate;
// only the last RING_SIZE stay in memory and nothing leaves the device unless:
//   • a severe violation happens → the segment showing it is uploaded once it
//     is complete (src/lib/clip-segments.ts picks which one);
//   • the exam's teacher asks for "the last 30 seconds" → the newest segments
//     are uploaded at once.
// Capped per attempt and spaced out; the server re-checks everything
// (/api/proctor/evidence/clip). No AI, never stored in Supabase.

const VIDEO_BPS = 160_000
const AUDIO_BPS = 24_000
const MIN_GAP_MS = 30_000

export function useClipRecorder(
  examId: string,
  streamRef: React.RefObject<MediaStream | null>,
  active: boolean,
  /** Called after each clip the server actually stored. */
  onStored?: () => void,
) {
  const ringRef = useRef<Segment[]>([])
  const pendingRef = useRef<{ type: string; at: number }[]>([])
  const sentRef = useRef(0)
  const lastSentRef = useRef(0)
  const uploadedRef = useRef(new WeakSet<Blob>())
  const onStoredRef = useRef(onStored)
  useEffect(() => { onStoredRef.current = onStored }, [onStored])

  const upload = useCallback(async (seg: Segment, type: string) => {
    if (sentRef.current >= CLIP_MAX_PER_STUDENT || uploadedRef.current.has(seg.data)) return
    uploadedRef.current.add(seg.data)
    sentRef.current += 1
    try {
      const res = await fetch(`/api/proctor/evidence/clip?examId=${examId}&type=${type}`, {
        method: 'POST',
        headers: { 'Content-Type': seg.data.type || 'application/octet-stream' },
        body: seg.data,
        keepalive: seg.data.size < 60_000,
      })
      const data = res.ok ? await res.json().catch(() => ({})) : {}
      if (!data.stored) { sentRef.current -= 1; uploadedRef.current.delete(seg.data) }
      else onStoredRef.current?.()
    } catch {
      sentRef.current -= 1
      uploadedRef.current.delete(seg.data)
    }
  }, [examId])

  // Record segments while the attempt is proctored.
  useEffect(() => {
    if (!active || typeof MediaRecorder === 'undefined') return
    const stream = streamRef.current
    if (!stream) return
    const mimeType = pickClipMimeType(t => MediaRecorder.isTypeSupported(t))
    if (!mimeType) return
    let stopped = false
    let recorder: MediaRecorder | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const record = () => {
      if (stopped) return
      const chunks: Blob[] = []
      const start = Date.now()
      try {
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS })
      } catch { return }
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      recorder.onstop = () => {
        const seg: Segment = { start, end: Date.now(), data: new Blob(chunks, { type: mimeType }) }
        ringRef.current = [...ringRef.current, seg].slice(-RING_SIZE)
        // Violations waiting for this segment to finish.
        const waiting = pendingRef.current.filter(p => p.at <= seg.end)
        pendingRef.current = pendingRef.current.filter(p => p.at > seg.end)
        for (const p of waiting) {
          const chosen = segmentForViolation(ringRef.current, p.at)
          if (chosen) upload(chosen, p.type)
        }
        record()
      }
      recorder.start()
      timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop() }, CLIP_SEGMENT_MS)
    }
    record()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop() }
      ringRef.current = []
      pendingRef.current = []
    }
  }, [active, streamRef, upload])

  /** A severe violation just happened: send the segment that shows it. */
  const onViolation = useCallback((type: string) => {
    if (!active || !isEvidenceType(type)) return
    const now = Date.now()
    if (now - lastSentRef.current < MIN_GAP_MS || sentRef.current >= CLIP_MAX_PER_STUDENT) return
    lastSentRef.current = now
    pendingRef.current.push({ type, at: now })
  }, [active])

  /** The exam's teacher asked for the last `seconds` seconds. */
  const sendRecent = useCallback((seconds: number) => {
    if (!active) return
    for (const seg of recentSegments(ringRef.current, seconds, Date.now())) upload(seg, ON_REQUEST)
  }, [active, upload])

  return useMemo(() => ({ onViolation, sendRecent }), [onViolation, sendRecent])
}
