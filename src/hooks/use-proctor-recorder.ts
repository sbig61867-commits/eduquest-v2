'use client'

import { useCallback, useEffect, useRef } from 'react'

// Records local proctoring detections to the DB — batched + deduplicated,
// with ZERO AI. The in-browser detectors (MediaPipe/TF/audio/tab/fullscreen)
// call record(); this hook collapses repeats and flushes a compact batch to
// /api/proctor/events every FLUSH_INTERVAL, plus a final flush on demand
// (before submit) and on unmount.

const FLUSH_INTERVAL_MS = 15_000

interface Buffered { count: number; firstAt: string; lastAt: string; details?: string }

export interface ProctorRecorderControls {
  /** Buffer one detection. Repeats of the same type within a window are deduped into a count. */
  record: (type: string, details?: string) => void
  /** Send any buffered events now and wait for the write (call before submit). */
  flush: () => Promise<void>
}

export function useProctorRecorder(examId: string, active: boolean): ProctorRecorderControls {
  // type -> aggregated occurrence within the current (unflushed) window
  const bufferRef = useRef<Map<string, Buffered>>(new Map())
  const activeRef = useRef(active)
  // Sync the ref inside an effect (not during render) so record() always sees
  // the latest active flag without re-creating the callback.
  useEffect(() => { activeRef.current = active }, [active])

  const record = useCallback((type: string, details?: string) => {
    if (!activeRef.current) return
    const now = new Date().toISOString()
    const existing = bufferRef.current.get(type)
    if (existing) {
      // Dedup: bump the count and extend the window instead of a new entry.
      existing.count += 1
      existing.lastAt = now
      if (details) existing.details = details
    } else {
      bufferRef.current.set(type, { count: 1, firstAt: now, lastAt: now, details })
    }
  }, [])

  const flush = useCallback(async () => {
    if (bufferRef.current.size === 0) return
    // Snapshot + clear immediately so new detections start a fresh window.
    const events = [...bufferRef.current.entries()].map(([type, b]) => ({
      type,
      timestamp: b.lastAt,
      first_at: b.firstAt,
      count: b.count,
      details: b.details,
    }))
    bufferRef.current.clear()

    try {
      await fetch('/api/proctor/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId, events }),
        keepalive: true, // let it complete even if the page is unloading
      })
    } catch {
      // Network hiccup must never interrupt the exam. Events are best-effort;
      // the periodic interval will keep trying with subsequent detections.
    }
  }, [examId])

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => { flush() }, FLUSH_INTERVAL_MS)
    return () => {
      clearInterval(id)
      // Best-effort final flush of whatever is buffered on unmount.
      flush()
    }
  }, [active, flush])

  return { record, flush }
}
