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
  const [page, setPage] = useState(0)
  const [zoomed, setZoomed] = useState<string | null>(null)
  const roomRef = useRef<Room | null>(null)
  const mediaEls = useRef<Record<string, { video?: HTMLVideoElement; audio?: HTMLAudioElement }>>({})

  const PAGE_SIZE = 9

  useEffect(() => {
    if (!liveConfigured) return
    let cancelled = false
    // adaptiveStream: LiveKit sends each tile only the resolution its size
    // needs, so a wall of small tiles stays smooth instead of pulling full
    // streams for every student.
    const room = new Room({ adaptiveStream: true })
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
      // Show the student card as soon as they join, even before tracks are subscribed.
      .on(RoomEvent.ParticipantConnected, participant => {
        upsert(participant.identity, { name: participant.name || participant.identity })
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
        if (cancelled) return
        setStatus('live')
        // Attach tracks from students who were already in the room when we joined.
        // TrackSubscribed fires for new subscriptions but may be missed for
        // pre-existing participants during the connect handshake.
        for (const participant of room.remoteParticipants.values()) {
          upsert(participant.identity, { name: participant.name || participant.identity })
          for (const pub of participant.trackPublications.values()) {
            if (pub.isSubscribed && pub.track) {
              attach(pub.track as RemoteTrack, participant)
            }
          }
        }
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

  // Speakers first so anyone making noise floats to the visible page.
  const list = Object.values(feeds).sort((a, b) => Number(b.speaking) - Number(a.speaking))
  const zoomedFeed = zoomed ? feeds[zoomed] : null
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  // Only the current page (or the zoomed student) is rendered → adaptiveStream
  // pauses every off-page track, so the teacher's bandwidth stays flat no
  // matter how many students are in the exam.
  const visible = zoomedFeed ? [zoomedFeed] : list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/teacher/proctoring')} className="text-fg-secondary hover:text-fg"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-fg">Live Monitoring — {examTitle}</h2>
          <p className="text-fg-secondary text-sm flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> {list.length} student{list.length === 1 ? '' : 's'} connected
          </p>
        </div>
        {status === 'live' && (
          <button onClick={() => setMuted(m => !m)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${muted ? 'bg-surface text-fg-secondary hover:bg-canvas' : 'bg-accent text-accent-fg'}`}>
            {muted ? <><MicOff className="w-4 h-4" /> الصوت مكتوم — اضغط للاستماع</> : <><Volume2 className="w-4 h-4" /> تستمع لكل الطلاب</>}
          </button>
        )}
      </div>

      {status === 'disabled' && (
        <div className="bg-accent-subtle border border-warning/30 rounded-lg px-4 py-3 text-warning text-sm">
          المراقبة الحية غير مُهيّأة بعد (مفاتيح LiveKit غير مضبوطة). المراقبة بالمخالفات المسجّلة تعمل كالمعتاد.
        </div>
      )}
      {status === 'connecting' && <p className="text-fg-muted text-sm py-8 text-center">جاري الاتصال بغرفة المراقبة...</p>}
      {status === 'error' && <p className="text-red-400 text-sm py-8 text-center">تعذّر الاتصال بالمراقبة الحية. حاول تحديث الصفحة.</p>}

      {status === 'live' && list.length === 0 && (
        <div className="text-center py-16 bg-surface border border-border rounded-lg">
          <Video className="w-10 h-10 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">لا يوجد طلاب في الاختبار الآن.</p>
          <p className="text-fg-muted text-sm mt-1">سيظهر كل طالب هنا فور دخوله الاختبار.</p>
        </div>
      )}

      {zoomedFeed && (
        <button onClick={() => setZoomed(null)} className="text-sm text-fg-secondary hover:text-fg flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> رجوع للجدار الكامل
        </button>
      )}

      {list.length > 0 && (
        <div className={zoomedFeed ? 'grid grid-cols-1' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'}>
          {
            // eslint-disable-next-line react-hooks/refs -- mediaEls holds imperative video DOM elements; reading .current during render is the correct pattern here (StudentTile receives the element as a prop and appends it via effect)
            visible.map(f => {
              const videoEl = mediaEls.current[f.identity]?.video
              return (
                <StudentTile key={f.identity} feed={f} videoEl={videoEl}
                  zoomed={!!zoomedFeed}
                  onClick={() => setZoomed(z => z === f.identity ? null : f.identity)} />
              )
            })
          }
        </div>
      )}

      {/* Pagination — only shown when there are more students than one page */}
      {!zoomedFeed && pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
            className="px-3 py-1.5 rounded-lg bg-surface text-fg-secondary text-sm disabled:opacity-40 hover:bg-canvas">السابق</button>
          <span className="text-fg-secondary text-sm">صفحة {safePage + 1} / {pageCount}</span>
          <button disabled={safePage >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            className="px-3 py-1.5 rounded-lg bg-surface text-fg-secondary text-sm disabled:opacity-40 hover:bg-canvas">التالي</button>
        </div>
      )}
    </div>
  )
}

function StudentTile({ feed, videoEl, zoomed, onClick }: { feed: Feed; videoEl?: HTMLVideoElement; zoomed?: boolean; onClick?: () => void }) {
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = holder.current
    if (el && videoEl && videoEl.parentElement !== el) {
      el.innerHTML = ''
      el.appendChild(videoEl)
    }
  }, [videoEl, feed.hasVideo])

  return (
    <div onClick={onClick}
      title={zoomed ? '' : 'اضغط للتكبير بجودة أعلى'}
      className={`relative rounded-lg overflow-hidden border-2 bg-canvas transition-colors cursor-pointer ${zoomed ? 'aspect-video max-h-[70vh] mx-auto w-full' : 'aspect-video'} ${feed.speaking ? 'border-success shadow-[0_0_0_3px_rgba(52,211,153,0.3)]' : 'border-border hover:border-border-strong'}`}>
      <div ref={holder} className="absolute inset-0 flex items-center justify-center">
        {!feed.hasVideo && <VideoOff className="w-8 h-8 text-fg-muted" />}
      </div>
      {/* Speaking badge — tells the teacher WHO the sound is coming from */}
      {feed.speaking && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-success text-fg text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
          <Volume2 className="w-3 h-3" /> يتكلم
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 flex items-center justify-between">
        <span className="text-fg text-sm font-medium truncate">{feed.name}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {feed.hasAudio ? <Mic className="w-3.5 h-3.5 text-accent" /> : <MicOff className="w-3.5 h-3.5 text-red-400" />}
          {feed.hasVideo ? <Video className="w-3.5 h-3.5 text-accent" /> : <VideoOff className="w-3.5 h-3.5 text-red-400" />}
        </span>
      </div>
    </div>
  )
}
