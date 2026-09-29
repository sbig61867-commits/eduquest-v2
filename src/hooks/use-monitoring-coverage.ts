'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { MonitoringSummary } from '@/lib/proctoring-events'

// How much of a proctored attempt the camera detectors actually watched.
//
// Each analysed frame calls onFrame(); the time since the previous frame is
// counted as "covered", up to MAX_CREDIT_MS (a detector sampling every few
// seconds is continuous monitoring; a minute of silence is not). If no frame
// arrives for GAP_MS while the page is visible — detectors frozen, camera
// stalled, or the page tampered with — onGap() is called once for that gap.
// At submit, summary() gives the totals written as the `monitoring_summary`
// event, so a quiet report can be told apart from an unmonitored one.

const MAX_CREDIT_MS = 10_000
const GAP_MS = 30_000
const CHECK_MS = 5_000

interface State { start: number; last: number; covered: number; frames: number; inGap: boolean }

export function useMonitoringCoverage(active: boolean, onGap: (seconds: number) => void) {
  const stateRef = useRef<State>({ start: 0, last: 0, covered: 0, frames: 0, inGap: false })
  const onGapRef = useRef(onGap)
  useEffect(() => { onGapRef.current = onGap }, [onGap])

  useEffect(() => {
    if (!active) return
    const now = Date.now()
    stateRef.current = { start: now, last: now, covered: 0, frames: 0, inGap: false }
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const s = stateRef.current
      const gap = Date.now() - s.last
      if (gap > GAP_MS && !s.inGap) {
        s.inGap = true
        onGapRef.current(Math.round(gap / 1000))
      }
    }, CHECK_MS)
    return () => clearInterval(id)
  }, [active])

  const onFrame = useCallback(() => {
    const s = stateRef.current
    if (!s.start) return
    const now = Date.now()
    s.covered += Math.min(now - s.last, MAX_CREDIT_MS)
    s.last = now
    s.frames += 1
    s.inGap = false
  }, [])

  const summary = useCallback((): MonitoringSummary | null => {
    const s = stateRef.current
    if (!s.start) return null
    return { coveredMs: s.covered, totalMs: Math.max(1, Date.now() - s.start), frames: s.frames }
  }, [])

  return { onFrame, summary }
}
