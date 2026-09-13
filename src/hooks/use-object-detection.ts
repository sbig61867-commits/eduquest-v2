'use client'

import { useEffect, useRef, useCallback } from 'react'

const SUSPICIOUS_OBJECTS = ['cell phone', 'book', 'laptop', 'tv', 'remote', 'keyboard']
const SAMPLE_INTERVAL_MS = 5000

type OnViolation = (type: string, details?: string) => void
type OnUnavailable = (detector: string, reason: string) => void

interface CocoSsdModel {
  detect(video: HTMLVideoElement): Promise<Array<{ class: string; score: number }>>
  dispose?(): void
}

// Runs entirely on the student's device (TensorFlow.js, WebGL with automatic
// CPU fallback). No frame ever leaves the browser for analysis.
export function useObjectDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onViolation: OnViolation,
  onUnavailable?: OnUnavailable,
) {
  const modelRef = useRef<CocoSsdModel | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // On a slow device one inference can take longer than the sample interval;
  // without this guard setInterval stacks overlapping inferences and pins the
  // student's CPU/GPU for the whole exam. Skip a tick instead.
  const busyRef = useRef(false)
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => { onUnavailableRef.current = onUnavailable }, [onUnavailable])

  const detect = useCallback(async () => {
    if (busyRef.current) return
    if (!videoRef.current || !modelRef.current) return
    const video = videoRef.current
    if (video.readyState < 2 || video.videoWidth === 0) return

    busyRef.current = true
    try {
      const predictions = await modelRef.current.detect(video)
      for (const pred of predictions) {
        const label = pred.class.toLowerCase()
        if (SUSPICIOUS_OBJECTS.includes(label) && pred.score > 0.5) {
          onViolation('suspicious_activity', `${pred.class} detected (${Math.round(pred.score * 100)}% confidence)`)
          break
        }
      }
      // Count people
      const people = predictions.filter(p => p.class === 'person' && p.score > 0.5)
      if (people.length > 1) {
        onViolation('multiple_faces', `${people.length} people detected in frame`)
      }
    } catch {
    } finally {
      busyRef.current = false
    }
  }, [videoRef, onViolation])

  useEffect(() => {
    if (!enabled) return
    let stopped = false

    async function init() {
      const tf = await import('@tensorflow/tfjs')
      await tf.ready()
      const cocoSsd = await import('@tensorflow-models/coco-ssd')
      if (stopped) return
      modelRef.current = await cocoSsd.load({ base: 'lite_mobilenet_v2' })
      if (stopped) return
      intervalRef.current = setInterval(detect, SAMPLE_INTERVAL_MS)
    }

    init().catch(err => {
      if (stopped) return
      onUnavailableRef.current?.('object_detection', err instanceof Error ? err.message : String(err))
    })

    return () => {
      stopped = true
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      // Dispose TF model to free GPU memory
      modelRef.current?.dispose?.()
      modelRef.current = null
      busyRef.current = false
    }
  }, [enabled, detect])
}
