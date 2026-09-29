'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { Room } from 'livekit-client'
import { WATCHING_ATTRIBUTE, parseWatching } from '@/lib/live-channel'

// Publishes the student's camera + mic to the exam's LiveKit room — but only
// while the teacher is watching THIS student (`active` comes from the exam's
// live channel, src/hooks/use-exam-live-channel.ts). Publish-only: students
// never see or hear each other. Silently no-ops when live proctoring isn't
// configured (503) or the teacher is not watching (409).
//
// LiveKit is the authority for how long streaming lasts: as soon as the
// teacher leaves the room or stops watching this student, the student leaves
// and onEnded() is called. Nothing is consumed while nobody is watching.
//
// It publishes the SAME MediaStream the exam page already opened for the
// on-device detectors, never a second capture. Opening the camera and the
// microphone twice on a phone halved the picture quality, ran the audio
// processing twice (choppy, noisy sound) and doubled the CPU load.
//
// livekit-client (~480 KB) is imported only AFTER a token is granted.
const TOKEN_ATTEMPTS = 4
const TOKEN_RETRY_MS = 1_000 // waits 1 s, 2 s, 3 s between attempts

export function useLivePublish(
  examId: string,
  active: boolean,
  streamRef: RefObject<MediaStream | null>,
  onEnded?: () => void,
) {
  const onEndedRef = useRef(onEnded)
  useEffect(() => { onEndedRef.current = onEnded }, [onEnded])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let room: Room | null = null
    const end = () => { if (!cancelled) onEndedRef.current?.() }

    ;(async () => {
      // Retry the token fetch (network blips are common). A 409 is retried
      // too: the teacher updates its LiveKit `watching` attribute and then
      // signals the student at once, so the student's first request can reach
      // the server a moment before LiveKit reports the new attribute (seen on
      // the first real phone test). Only a 409 that persists means "not
      // watched" and ends the attempt.
      let token: string | null = null
      let url: string | null = null
      let teacher: string | null = null
      let self: string | null = null
      let notWatched = false
      for (let attempt = 0; attempt < TOKEN_ATTEMPTS && !cancelled; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, TOKEN_RETRY_MS * attempt))
          if (cancelled) return
          const res = await fetch('/api/proctor/live-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ examId, role: 'student' }),
          })
          if (res.status === 503) return           // LiveKit not configured
          notWatched = res.status === 409          // not (yet) watched
          if (!res.ok) continue                     // transient error or 409, retry
          const json = await res.json()
          token = json.token; url = json.url; teacher = json.teacher ?? null; self = json.identity ?? null
          break
        } catch {
          // network error — retry
        }
      }
      if (cancelled) return
      if (!token || !url) { if (notWatched) end(); return }

      const stream = streamRef.current
      if (!stream) return
      const [video] = stream.getVideoTracks()
      const [audio] = stream.getAudioTracks()

      const { Room: LiveRoom, RoomEvent, Track, VideoPresets } = await import('livekit-client')
      if (cancelled) return
      const live = new LiveRoom({
        adaptiveStream: true,
        dynacast: true,
        // These tracks belong to the exam page (its detectors keep reading
        // them): leaving or losing the room must never stop the camera.
        stopLocalTrackOnUnpublish: false,
      })
      room = live

      // Leave as soon as the teacher leaves the room or stops watching us.
      // Only explicit events about the teacher count; the teacher's live
      // channel broadcast (use-exam-live-channel) is the second way out.
      const leave = () => {
        live.disconnect(false).catch(() => {})
        end()
      }
      live
        .on(RoomEvent.ParticipantDisconnected, p => { if (teacher && p.identity === teacher) leave() })
        .on(RoomEvent.ParticipantAttributesChanged, (_changed, p) => {
          if (!teacher || !self || p.identity !== teacher) return
          if (!parseWatching(p.attributes?.[WATCHING_ATTRIBUTE]).includes(self)) leave()
        })
        .on(RoomEvent.Disconnected, end)

      try {
        await live.connect(url, token)
        if (cancelled) { await live.disconnect(false); return }
        if (video) {
          // Tell the encoder that motion matters more than fine detail.
          video.contentHint = 'motion'
          await live.localParticipant.publishTrack(video, {
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
          await live.localParticipant.publishTrack(audio, {
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
