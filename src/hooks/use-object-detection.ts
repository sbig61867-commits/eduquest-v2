'use client'

import { useEffect, useRef, useCallback } from 'react'

const SUSPICIOUS_OBJECTS = ['cell phone', 'book', 'laptop', 'tv', 'remote', 'keyboard']

type OnViolation = (type: string, details?: string) => void

interface CocoSsdModel {
  detect(video: HTMLVideoElement): Promise<Array<{ class: string; score: number }>>
  dispose?(): void
}

export function useObjectDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onViolation: OnViolation
) {
  const modelRef = useRef<CocoSsdModel | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const detect = useCallback(async () => {
    if (!videoRef.current || !modelRef.current) return
    const video = videoRef.current
    if (video.readyState < 2 || video.videoWidth === 0) return

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
    } catch {}
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
      intervalRef.current = setInterval(detect, 5000)
    }

    init().catch(() => {})

    return () => {
      stopped = true
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      // Dispose TF model to free GPU memory
      modelRef.current?.dispose?.()
      modelRef.current = null
    }
  }, [enabled, detect])
}
