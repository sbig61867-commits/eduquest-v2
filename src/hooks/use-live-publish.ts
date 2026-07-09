'use client'

import { useEffect, useRef } from 'react'
import { Room, RoomEvent, VideoPresets } from 'livekit-client'

// Publishes the student's camera + mic to the exam's LiveKit room so the
// teacher can watch/listen live. Publish-only (student can't see others).
// Silently no-ops when live proctoring isn't configured (503) — the
// existing frame-based Gemini proctoring keeps working regardless.
export function useLivePublish(examId: string, active: boolean) {
  const roomRef = useRef<Room | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        // Front camera — proctoring must see the student's face, not the
        // room behind them (phones default to the rear/environment camera).
        facingMode: 'user',
        // Small steady picture at 15fps — proctoring needs clarity, not
        // smooth motion; lighter capture means fewer dropped frames.
        resolution: { width: 640, height: 360, frameRate: 15 },
      },
      publishDefaults: {
        // VP8, NOT VP9: VP8 has near-universal *hardware* encoding on phones,
        // so it's light on the CPU and doesn't freeze. VP9 software-encodes on
        // most mobiles → CPU overload → the jitter/freezing seen in testing.
        videoCodec: 'vp8',
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        // Audio matters most for proctoring — keep it clean, resilient, mono.
        dtx: true,
        red: true,
        audioPreset: { maxBitrate: 24_000 },
      },
    })
    roomRef.current = room

    ;(async () => {
      try {
        const res = await fetch('/api/proctor/live-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId, role: 'student' }),
        })
        if (!res.ok) return // 503 not configured, or not enrolled — skip live layer
        const { token, url } = await res.json()
        if (cancelled) return
        await room.connect(url, token)
        if (cancelled) { await room.disconnect(); return }
        await room.localParticipant.setCameraEnabled(true)
        await room.localParticipant.setMicrophoneEnabled(true)
      } catch (e) {
        console.error('[live-publish]', e)
      }
    })()

    const onDisconnect = () => { /* teacher-side handles presence */ }
    room.on(RoomEvent.Disconnected, onDisconnect)

    return () => {
      cancelled = true
      room.off(RoomEvent.Disconnected, onDisconnect)
      room.disconnect().catch(() => {})
      roomRef.current = null
    }
  }, [examId, active])
}
