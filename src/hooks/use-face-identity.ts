'use client'

import { useEffect, useRef } from 'react'
import { IdentityTracker, canRunIdentityChecks } from '@/lib/face-identity'

type OnViolation = (type: string, details?: string) => void
type OnUnavailable = (detector: string, reason: string) => void

// Identity continuity (src/lib/face-identity.ts) with @vladmandic/human, on
// the student's device only. Capable devices on a fast connection only; the
// ~8 MB of models are served from our own origin (scripts/copy-human-models.mjs)
// and loaded START_DELAY_MS after the exam starts, so they never slow the
// start. One check every CHECK_MS — cheap enough for a laptop, off on weak
// phones where the light detectors keep running alone.

const MODEL_BASE = '/models/human/'
const START_DELAY_MS = 15_000
const ENROLL_EVERY_MS = 2_000
const CHECK_MS = 20_000

export function useFaceIdentity(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onViolation: OnViolation,
  onUnavailable?: OnUnavailable,
) {
  const onViolationRef = useRef(onViolation)
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => { onViolationRef.current = onViolation }, [onViolation])
  useEffect(() => { onUnavailableRef.current = onUnavailable }, [onUnavailable])

  useEffect(() => {
    if (!enabled) return
    if (!canRunIdentityChecks(navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number })) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let dispose: (() => void) | null = null

    const start = setTimeout(async () => {
      try {
        const { Human } = await import('@vladmandic/human')
        if (stopped) return
        const human = new Human({
          modelBasePath: MODEL_BASE,
          backend: 'webgl',
          debug: false,
          warmup: 'none',
          cacheSensitivity: 0,
          filter: { enabled: false },
          face: {
            enabled: true,
            detector: { enabled: true, modelPath: 'blazeface.json', rotation: false, maxDetected: 2 },
            mesh: { enabled: false },
            attention: { enabled: false },
            iris: { enabled: false },
            description: { enabled: true, modelPath: 'faceres.json' },
            antispoof: { enabled: true, modelPath: 'antispoof.json' },
            liveness: { enabled: false },
            emotion: { enabled: false },
            gear: { enabled: false },
          },
          body: { enabled: false },
          hand: { enabled: false },
          object: { enabled: false },
          gesture: { enabled: false },
          segmentation: { enabled: false },
        })
        await human.load()
        if (stopped) return
        dispose = () => { try { human.tf.engine().disposeVariables() } catch { /* ignore */ } }
        const tracker = new IdentityTracker((a, b) => human.match.similarity(a, b))

        const tick = async () => {
          if (stopped) return
          const video = videoRef.current
          if (video && video.readyState >= 2 && video.videoWidth > 0 && document.visibilityState === 'visible') {
            try {
              const result = await human.detect(video)
              const verdict = tracker.observe(result.face.map(f => ({ embedding: f.embedding, real: f.real })))
              if (verdict.kind === 'mismatch') onViolationRef.current('face_mismatch', `similarity ${verdict.similarity.toFixed(2)}`)
              if (verdict.kind === 'spoof') onViolationRef.current('spoof_detected', `real ${verdict.real.toFixed(2)}`)
            } catch { /* one bad frame; the next tick tries again */ }
          }
          if (!stopped) timer = setTimeout(tick, tracker.isEnrolled ? CHECK_MS : ENROLL_EVERY_MS)
        }
        tick()
      } catch (err) {
        if (!stopped) onUnavailableRef.current?.('face_identity', err instanceof Error ? err.message : String(err))
      }
    }, START_DELAY_MS)

    return () => {
      stopped = true
      clearTimeout(start)
      if (timer) clearTimeout(timer)
      dispose?.()
    }
  }, [enabled, videoRef])
}
