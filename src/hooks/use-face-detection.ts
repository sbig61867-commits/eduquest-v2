'use client'

import { useEffect, useRef, useCallback } from 'react'

type OnViolation = (type: string, details?: string) => void
type OnUnavailable = (detector: string, reason: string) => void

interface Keypoint { x: number; y: number }
interface BoundingBox { originX: number; originY: number; width: number; height: number }
interface FaceDetection {
  keypoints?: Keypoint[]
  boundingBox?: BoundingBox
}
interface FaceDetectorInstance {
  detectForVideo(video: HTMLVideoElement, timestamp: number): { detections: FaceDetection[] }
  close?(): void
}

// Pinned to the installed @mediapipe/tasks-vision version. This used to load
// "@latest" from the CDN, so any future MediaPipe release with a breaking WASM
// change would have silently disabled face detection for every exam (load
// errors were swallowed). Bump together with package.json.
const MEDIAPIPE_VERSION = '0.10.35'
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const SAMPLE_INTERVAL_MS = 4000

// Runs entirely on the student's device (WASM + WebGL/CPU). No frame ever
// leaves the browser for analysis.
export function useFaceDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onViolation: OnViolation,
  onUnavailable?: OnUnavailable,
) {
  const detectorRef = useRef<FaceDetectorInstance | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Latest callback without re-initialising the model when its identity changes.
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => { onUnavailableRef.current = onUnavailable }, [onUnavailable])

  const analyze = useCallback(async () => {
    if (!videoRef.current || !detectorRef.current) return
    const video = videoRef.current
    if (video.readyState < 2) return

    try {
      const result = detectorRef.current.detectForVideo(video, performance.now())
      const faces = result.detections ?? []
      const faceCount = faces.length

      if (faceCount === 0) {
        onViolation('face_not_detected', 'No face visible in camera')
        return
      }

      if (faceCount > 1) {
        onViolation('multiple_faces', `${faceCount} faces detected`)
      }

      // Check gaze using nose and eye keypoints
      // MediaPipe FaceDetector returns: right_eye(0), left_eye(1), nose_tip(2), mouth_center(3)
      const detection = faces[0]
      const kps = detection.keypoints
      if (kps && kps.length >= 3) {
        const rightEye = kps[0]
        const leftEye = kps[1]
        const nose = kps[2]

        // MediaPipe keypoints are normalised [0,1]; boundingBox is also normalised
        const box = detection.boundingBox
        if (!box) return
        const boxW = video.videoWidth > 0 ? video.videoWidth : 1
        const boxCenterXNorm = (box.originX + box.width / 2) / boxW
        const boxWidthNorm = box.width / boxW

        // Nose offset relative to face width — avoids mixing pixel/normalised coords
        const noseOffsetX = Math.abs(nose.x - boxCenterXNorm) / Math.max(boxWidthNorm, 0.01)
        const eyeLevel = (rightEye.y + leftEye.y) / 2
        const noseLevel = nose.y

        // If nose drops well below eyes relative to face height → looking down
        const lookingDown = (noseLevel - eyeLevel) > 0.25
        // noseOffsetX is now ratio of face width — > 0.3 means clearly looking away
        const lookingAway = noseOffsetX > 0.3 || lookingDown

        if (lookingAway) {
          onViolation('looking_away', 'Student not looking at screen')
        }
      }
    } catch {}
  }, [videoRef, onViolation])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function init() {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
      if (cancelled) return

      const create = (delegate: 'GPU' | 'CPU') => FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      })

      // GPU first; low-end or WebGL-less devices fall back to CPU instead of
      // silently running with no face detection at all.
      try {
        detectorRef.current = await create('GPU')
      } catch {
        detectorRef.current = await create('CPU')
      }
      if (cancelled) { detectorRef.current?.close?.(); return }
      intervalRef.current = setInterval(analyze, SAMPLE_INTERVAL_MS)
    }

    init().catch(err => {
      if (cancelled) return
      onUnavailableRef.current?.('face_detection', err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelled = true
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      detectorRef.current?.close?.()
      detectorRef.current = null
    }
  }, [enabled, analyze])
}
