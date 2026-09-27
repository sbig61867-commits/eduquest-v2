'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { THUMB_EVENT, THUMB_EVERY_MS, thumbsTopic } from '@/lib/live-channel'

// The student's side of the teacher's thumbnail wall: while `active` (the
// teacher's wall is open and this student is not being watched in video), a
// ~4 KB picture of the exam camera is sent every THUMB_EVERY_MS as a Realtime
// broadcast over HTTP (no join, so this student can never read anyone else's).
// Nothing is stored anywhere. Only the exam's teacher can read the topic
// (supabase/live_thumbnails_migration.sql); until that migration is applied
// the first send is refused and the sender stops for this attempt.

const W = 160
const H = 120

export function useThumbnailSender(
  examId: string,
  userId: string,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const supabase = createClient()
    const channel = supabase.channel(thumbsTopic(examId), { config: { private: true } })
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    let stopped = false

    const send = async () => {
      const video = videoRef.current
      const ctx = canvas.getContext('2d')
      if (!video || !ctx || video.readyState < 2 || document.visibilityState !== 'visible') return
      ctx.drawImage(video, 0, 0, W, H)
      let url = canvas.toDataURL('image/webp', 0.4)
      if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.45)
      try {
        await supabase.realtime.setAuth()
        const res = await channel.httpSend(THUMB_EVENT, { id: userId, img: url, at: Date.now() })
        if (!res.success && (res.status === 401 || res.status === 403)) stopped = true // not permitted: stop
      } catch { /* network blip: next tick */ }
    }

    send()
    const id = setInterval(() => { if (!stopped) send() }, THUMB_EVERY_MS)
    return () => {
      clearInterval(id)
      supabase.removeChannel(channel)
    }
  }, [examId, userId, videoRef, active])
}
