'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Room, RoomEvent, Track, RemoteTrack, RemoteParticipant,
  type RemoteTrackPublication,
} from 'livekit-client'
import { ArrowLeft, Mic, MicOff, Video, VideoOff, Volume2, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Feed {
  identity: string
  name: string
  videoEl: HTMLVideoElement | null
  audioEl: HTMLAudioElement | null
  hasVideo: boolean
  hasAudio: boolean
  speaking: boolean
}

export function LiveMonitor({ examId, examTitle, liveConfigured }: { examId: string; examTitle: string; liveConfigured: boolean }) {
  const router = useRouter()
  const [feeds, setFeeds] = useState<Record<string, Feed>>({})
  const [status, setStatus] = useState<'connecting' | 'live' | 'error' | 'disabled'>(liveConfigured ? 'connecting' : 'disabled')
  const [muted, setMuted] = useState(true)
  const roomRef = useRef<Room | null>(null)
  const mediaEls = useRef<Record<string, { video?: HTMLVideoElement; audio?: HTMLAudioElement }>>({})

  useEffect(() => {
    if (!liveConfigured) return
    let cancelled = false
    const room = new Room()
    roomRef.current = room

    function upsert(identity: string, patch: Partial<Feed>) {
      setFeeds(prev => {
        const base: Feed = prev[identity] ?? {
          identity, name: identity, videoEl: null, audioEl: null,
          hasVideo: false, hasAudio: false, speaking: false,
        }
        return { ...prev, [identity]: { ...base, ...patch } }
      })
    }

    function attach(track: RemoteTrack, participant: RemoteParticipant) {
      const id = participant.identity
      mediaEls.current[id] ??= {}
      if (track.kind === Track.Kind.Video) {
        const el = track.attach() as HTMLVideoElement
        el.muted = true; el.className = 'w-full h-full object-cover'
        mediaEls.current[id].video = el
        upsert(id, { name: participant.name || id, hasVideo: true })
      } else if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement
        mediaEls.current[id].audio = el
        upsert(id, { name: participant.name || id, hasAudio: true })
      }
    }

    room
      .on(RoomEvent.TrackSubscribed, (track, _pub: RemoteTrackPublication, participant) => attach(track, participant))
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        track.detach()
        const id = participant.identity
        if (track.kind === Track.Kind.Video) upsert(id, { hasVideo: false })
        if (track.kind === Track.Kind.Audio) upsert(id, { hasAudio: false })
      })
      .on(RoomEvent.ActiveSpeakersChanged, speakers => {
        const ids = new Set(speakers.map(s => s.identity))
        setFeeds(prev => {
          const next = { ...prev }
          for (const id of Object.keys(next)) next[id] = { ...next[id], speaking: ids.has(id) }
          return next
        })
      })
      .on(RoomEvent.ParticipantDisconnected, participant => {
        setFeeds(prev => { const n = { ...prev }; delete n[participant.identity]; return n })
        delete mediaEls.current[participant.identity]
      })
      .on(RoomEvent.Disconnected, () => { if (!cancelled) setStatus('error') })

    ;(async () => {
      try {
        const res = await fetch('/api/proctor/live-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId, role: 'teacher' }),
        })
        if (!res.ok) { setStatus('error'); return }
        const { token, url } = await res.json()
        if (cancelled) return
        await room.connect(url, token)
        setStatus('live')
      } catch (e) {
        console.error('[live-monitor]', e)
        if (!cancelled) setStatus('error')
      }
    })()

    return () => { cancelled = true; room.disconnect().catch(() => {}); roomRef.current = null }
  }, [examId, liveConfigured])

  // Teacher hears everyone: unmute all remote audio elements together.
  useEffect(() => {
    for (const m of Object.values(mediaEls.current)) {
      if (m.audio) m.audio.muted = muted
    }
    // Audio elements must be in the DOM to play — park them hidden.
    for (const [id, m] of Object.entries(mediaEls.current)) {
      if (m.audio && !m.audio.isConnected) {
        m.audio.id = `aud-${id}`
        m.audio.style.display = 'none'
        document.body.appendChild(m.audio)
      }
    }
  }, [muted, feeds])

  const list = Object.values(feeds)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/teacher/proctoring')} className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-white">Live Monitoring — {examTitle}</h2>
          <p className="text-slate-400 text-sm flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> {list.length} student{list.length === 1 ? '' : 's'} connected
          </p>
        </div>
        {status === 'live' && (
          <button onClick={() => setMuted(m => !m)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${muted ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-emerald-600 text-white'}`}>
            {muted ? <><MicOff className="w-4 h-4" /> الصوت مكتوم — اضغط للاستماع</> : <><Volume2 className="w-4 h-4" /> تستمع لكل الطلاب</>}
          </button>
        )}
      </div>

      {status === 'disabled' && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-sm">
          المراقبة الحية غير مُهيّأة بعد (مفاتيح LiveKit غير مضبوطة). المراقبة بالمخالفات المسجّلة تعمل كالمعتاد.
        </div>
      )}
      {status === 'connecting' && <p className="text-slate-500 text-sm py-8 text-center">جاري الاتصال بغرفة المراقبة...</p>}
      {status === 'error' && <p className="text-red-400 text-sm py-8 text-center">تعذّر الاتصال بالمراقبة الحية. حاول تحديث الصفحة.</p>}

      {status === 'live' && list.length === 0 && (
        <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
          <Video className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">لا يوجد طلاب في الاختبار الآن.</p>
          <p className="text-slate-500 text-sm mt-1">سيظهر كل طالب هنا فور دخوله الاختبار.</p>
        </div>
      )}

      {list.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map(f => (
            <StudentTile key={f.identity} feed={f} videoEl={mediaEls.current[f.identity]?.video} />
          ))}
        </div>
      )}
    </div>
  )
}

function StudentTile({ feed, videoEl }: { feed: Feed; videoEl?: HTMLVideoElement }) {
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = holder.current
    if (el && videoEl && videoEl.parentElement !== el) {
      el.innerHTML = ''
      el.appendChild(videoEl)
    }
  }, [videoEl, feed.hasVideo])

  return (
    <div className={`relative rounded-xl overflow-hidden border-2 bg-slate-950 aspect-video transition-colors ${feed.speaking ? 'border-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.3)]' : 'border-slate-800'}`}>
      <div ref={holder} className="absolute inset-0 flex items-center justify-center">
        {!feed.hasVideo && <VideoOff className="w-8 h-8 text-slate-700" />}
      </div>
      {/* Speaking badge — tells the teacher WHO the sound is coming from */}
      {feed.speaking && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
          <Volume2 className="w-3 h-3" /> يتكلم
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 flex items-center justify-between">
        <span className="text-white text-sm font-medium truncate">{feed.name}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {feed.hasAudio ? <Mic className="w-3.5 h-3.5 text-emerald-400" /> : <MicOff className="w-3.5 h-3.5 text-red-400" />}
          {feed.hasVideo ? <Video className="w-3.5 h-3.5 text-emerald-400" /> : <VideoOff className="w-3.5 h-3.5 text-red-400" />}
        </span>
      </div>
    </div>
  )
}
