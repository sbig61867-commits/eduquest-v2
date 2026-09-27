'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { WATCH_EVENT, liveTopic, watchPayloadIncludes, type StudentPresence } from '@/lib/live-channel'

// The student's side of the per-exam live channel (see src/lib/live-channel.ts).
// It announces the student to the teacher's page and returns whether the
// teacher asked to watch this student live right now. Nothing is shown to the
// student either way. No table is read or written: presence and broadcast are
// Realtime messages only.

const PRESENCE_MIN_GAP_MS = 3_000

export function useExamLiveChannel(
  examId: string,
  userId: string,
  active: boolean,
  counts: StudentPresence,
): { watched: boolean; stopWatching: () => void } {
  const [watched, setWatched] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const subscribedRef = useRef(false)
  const countsRef = useRef(counts)
  const lastTrackRef = useRef(0)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { countsRef.current = counts }, [counts])

  useEffect(() => {
    if (!active) return
    const supabase = createClient()
    let cancelled = false

    ;(async () => {
      // A private channel is authorised with the user's own JWT.
      await supabase.realtime.setAuth()
      if (cancelled) return
      const channel = supabase.channel(liveTopic(examId), {
        config: { private: true, presence: { key: userId } },
      })
      channelRef.current = channel
      channel
        .on('broadcast', { event: WATCH_EVENT }, ({ payload }) => {
          setWatched(watchPayloadIncludes(payload, userId))
        })
        .subscribe(status => {
          subscribedRef.current = status === 'SUBSCRIBED'
          if (status === 'SUBSCRIBED') {
            lastTrackRef.current = Date.now()
            channel.track({ ...countsRef.current }).catch(() => {})
          }
        })
    })().catch(() => { /* live view is optional; the exam goes on */ })

    return () => {
      cancelled = true
      subscribedRef.current = false
      if (pendingRef.current) { clearTimeout(pendingRef.current); pendingRef.current = null }
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [examId, userId, active])

  // Keep the teacher's counts current, at most once every few seconds.
  useEffect(() => {
    const channel = channelRef.current
    if (!channel || !subscribedRef.current) return
    const send = () => {
      pendingRef.current = null
      lastTrackRef.current = Date.now()
      channel.track({ ...countsRef.current }).catch(() => {})
    }
    const wait = PRESENCE_MIN_GAP_MS - (Date.now() - lastTrackRef.current)
    if (wait <= 0) send()
    else if (!pendingRef.current) pendingRef.current = setTimeout(send, wait)
  }, [counts.v, counts.ev])

  const stopWatching = useCallback(() => setWatched(false), [])
  return { watched, stopWatching }
}
