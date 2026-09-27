'use client'

import { useEffect, type RefObject } from 'react'
import type { Room } from 'livekit-client'

// Publishes the student's camera + mic to the exam's LiveKit room so the
// teacher can watch/listen live. Publish-only (student can't see others).
// Silently no-ops when live proctoring isn't configured (503).
//
// It publishes the SAME MediaStream the exam page already opened for the
// on-device detectors, never a second capture. Opening the camera and the
// microphone twice on a phone halved the picture quality, ran the audio
// processing twice (choppy, noisy sound) and doubled the CPU load.
//
// livekit-client (~480 KB) is imported only AFTER a token is granted, so an
// exam without live proctoring — or a deployment without LiveKit — never
// downloads it, and the exam page opens faster on slow connections.
export function useLivePublish(examId: string, active: boolean, streamRef: RefObject<MediaStream | null>) {
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let room: Room | null = null

    ;(async () => {
      // Retry the token fetch up to 3 times (network blips on exam start are common).
      let token: string | null = null
      let url: string | null = null
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt))
          const res = await fetch('/api/proctor/live-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ examId, role: 'student' }),
          })
          if (res.status === 503) return // LiveKit not configured, skip silently
          if (!res.ok) continue          // transient error, retry
          const json = await res.json()
          token = json.token; url = json.url
          break
        } catch {
          // network error — retry
        }
      }
      if (!token || !url || cancelled) return

      const stream = streamRef.current
      if (!stream) return
      const [video] = stream.getVideoTracks()
      const [audio] = stream.getAudioTracks()

      const { Room: LiveRoom, Track, VideoPresets } = await import('livekit-client')
      if (cancelled) return
      room = new LiveRoom({
        adaptiveStream: true,
        dynacast: true,
        // These tracks belong to the exam page (its detectors keep reading
        // them): leaving or losing the room must never stop the camera.
        stopLocalTrackOnUnpublish: false,
      })

      try {
        await room.connect(url, token)
        if (cancelled) { await room.disconnect(false); return }
        if (video) {
          // Tell the encoder that motion matters more than fine detail.
          video.contentHint = 'motion'
          await room.localParticipant.publishTrack(video, {
            source: Track.Source.Camera,
            // VP8, NOT VP9: VP8 has near-universal *hardware* encoding on
            // phones, so it's light on the CPU and doesn't freeze.
            videoCodec: 'vp8',
            // Top layer: the camera's own size at up to 24 fps. A small 180p
            // layer lets the teacher's wall of tiles stay light.
            videoEncoding: { maxBitrate: 900_000, maxFramerate: 24 },
            simulcast: true,
            videoSimulcastLayers: [VideoPresets.h180],
            // On a weak connection drop sharpness, not frames: smooth motion
            // is what a proctor needs to follow.
            degradationPreference: 'maintain-framerate',
          })
        }
        if (audio) {
          await room.localParticipant.publishTrack(audio, {
            source: Track.Source.Microphone,
            // Clear speech: 32 kbps, redundant packets against loss, and no
            // DTX (it gated quiet moments and made the sound choppy).
            audioPreset: { maxBitrate: 32_000 },
            red: true,
            dtx: false,
          })
        }
      } catch (e) {
        console.error('[live-publish]', e)
      }
    })()

    return () => {
      cancelled = true
      room?.disconnect(false).catch(() => {})
      room = null
    }
  }, [examId, active, streamRef])
}
