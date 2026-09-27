'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Room, RemoteTrack, RemoteParticipant } from 'livekit-client'
import { ArrowLeft, Eye, EyeOff, MicOff, Radio, ShieldCheck, Video, VideoOff, Volume2, Users, WifiOff, AlertTriangle, Camera } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import {
  MAX_WATCHED, TEACHER_PRESENCE_KEY, WATCHING_ATTRIBUTE, WATCH_EVENT, liveTopic,
  type StudentPresence,
} from '@/lib/live-channel'
import { EvidencePanel } from './evidence-panel'

// The teacher's monitoring page. Two layers, both on demand:
//  1. The exam's live channel (Supabase Realtime, no table read): who is in
//     the exam right now and their violation / snapshot counts. Detection runs
//     silently on every student's device whether or not anyone watches.
//  2. Live video (LiveKit), OFF by default. The teacher turns it on and picks
//     students; only those stream, and only while this page is open. Closing
//     the page or turning it off stops every stream at once, so no LiveKit
//     minute is spent on students nobody is watching.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PAGE_SIZE = 9

interface Media {
  video?: HTMLVideoElement
  audio?: HTMLAudioElement
}

interface StreamState { hasVideo: boolean; hasAudio: boolean; speaking: boolean; weak: boolean }

type LiveStatus = 'off' | 'connecting' | 'live' | 'error'

export function LiveMonitor({ examId, examTitle, liveConfigured }: { examId: string; examTitle: string; liveConfigured: boolean }) {
  const router = useRouter()
  const t = useTranslations('teacher.live')

  // ── Layer 1: presence ──
  const [students, setStudents] = useState<Record<string, StudentPresence>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [channelStatus, setChannelStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
  const channelRef = useRef<RealtimeChannel | null>(null)

  // ── Layer 2: live video ──
  const [liveOn, setLiveOn] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('off')
  const [watching, setWatching] = useState<string[]>([])
  const [streams, setStreams] = useState<Record<string, StreamState>>({})
  const [muted, setMuted] = useState(true)
  const [zoomed, setZoomed] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const roomRef = useRef<Room | null>(null)
  const mediaEls = useRef<Record<string, Media>>({})

  // Students who left the exam can't stay in the watch list.
  const present = new Set(Object.keys(students))
  const watchingPresent = watching.filter(id => present.has(id))
  // The set every student reads: empty whenever live view is off.
  const watchKey = liveOn ? watchingPresent.join(',') : ''
  const watchRef = useRef('')
  useEffect(() => { watchRef.current = watchKey }, [watchKey])

  const sendWatch = useCallback(() => {
    const ids = watchRef.current ? watchRef.current.split(',') : []
    channelRef.current?.send({ type: 'broadcast', event: WATCH_EVENT, payload: { ids } }).catch(() => {})
  }, [])

  // ── Layer 1: join the exam's live channel for as long as the page is open ──
  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    ;(async () => {
      await supabase.realtime.setAuth()
      if (cancelled) return
      const channel = supabase.channel(liveTopic(examId), {
        config: { private: true, presence: { key: TEACHER_PRESENCE_KEY } },
      })
      channelRef.current = channel
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState<Partial<StudentPresence>>()
          const next: Record<string, StudentPresence> = {}
          for (const [key, metas] of Object.entries(state)) {
            // Keys are user ids; anything else is not a student of this exam.
            if (key === TEACHER_PRESENCE_KEY || !UUID_RE.test(key)) continue
            const m = metas[metas.length - 1]
            next[key] = { v: Number(m?.v) || 0, ev: Number(m?.ev) || 0 }
          }
          setStudents(next)
        })
        // A student who joins (or reconnects) late learns the current set.
        .on('presence', { event: 'join' }, ({ key }) => { if (key !== TEACHER_PRESENCE_KEY) sendWatch() })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            setChannelStatus('ready')
            channel.track({}).catch(() => {})
            sendWatch()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setChannelStatus('error')
          }
        })
    })().catch(() => { if (!cancelled) setChannelStatus('error') })

    return () => {
      cancelled = true
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [examId, sendWatch])

  // Names for new ids, one query per batch (never per tick).
  const studentIds = Object.keys(students).sort().join(',')
  useEffect(() => {
    const unknown = studentIds.split(',').filter(id => id && !(id in names))
    if (unknown.length === 0) return
    let cancelled = false
    createClient().from('users').select('id, full_name').in('id', unknown).then(({ data }) => {
      if (cancelled) return
      setNames(prev => {
        const next = { ...prev }
        for (const u of (data ?? []) as { id: string; full_name: string | null }[]) next[u.id] = u.full_name || '—'
        for (const id of unknown) next[id] ??= '—'
        return next
      })
    })
    return () => { cancelled = true }
  }, [studentIds, names])

  // ── Layer 2: LiveKit, connected only while live view is on ──
  const upsertStream = useCallback((id: string, patch: Partial<StreamState>) => {
    const empty: StreamState = { hasVideo: false, hasAudio: false, speaking: false, weak: false }
    setStreams(prev => ({ ...prev, [id]: { ...empty, ...prev[id], ...patch } }))
  }, [])

  useEffect(() => {
    if (!liveOn || !liveConfigured) return
    let cancelled = false
    let room: Room | null = null
    ;(async () => {
      const { Room: LiveRoom, RoomEvent, Track, ConnectionQuality } = await import('livekit-client')
      if (cancelled) return
      // adaptiveStream sizes each subscription to its tile (pixelDensity
      // 'screen': sharp on HiDPI screens), and pauses what is off screen.
      const live = new LiveRoom({ adaptiveStream: { pixelDensity: 'screen' } })
      room = live
      roomRef.current = live

      const attach = (track: RemoteTrack, participant: RemoteParticipant) => {
        const id = participant.identity
        mediaEls.current[id] ??= {}
        if (track.kind === Track.Kind.Video) {
          const el = track.attach() as HTMLVideoElement
          el.muted = true; el.playsInline = true; el.className = 'w-full h-full object-cover'
          mediaEls.current[id].video = el
          upsertStream(id, { hasVideo: true })
        } else if (track.kind === Track.Kind.Audio) {
          // Audio elements must be in the DOM to play — parked hidden.
          const el = track.attach() as HTMLAudioElement
          el.style.display = 'none'
          el.muted = true
          document.body.appendChild(el)
          mediaEls.current[id].audio = el
          upsertStream(id, { hasAudio: true })
        }
      }

      live
        .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => attach(track, participant))
        .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
          track.detach().forEach(el => { if (el instanceof HTMLAudioElement) el.remove() })
          const m = mediaEls.current[participant.identity]
          if (track.kind === Track.Kind.Video) { if (m) delete m.video; upsertStream(participant.identity, { hasVideo: false }) }
          if (track.kind === Track.Kind.Audio) { if (m) delete m.audio; upsertStream(participant.identity, { hasAudio: false }) }
        })
        .on(RoomEvent.ParticipantDisconnected, participant => {
          mediaEls.current[participant.identity]?.audio?.remove()
          delete mediaEls.current[participant.identity]
          setStreams(prev => { const n = { ...prev }; delete n[participant.identity]; return n })
        })
        .on(RoomEvent.ActiveSpeakersChanged, speakers => {
          const ids = new Set(speakers.map(s => s.identity))
          setStreams(prev => {
            const next = { ...prev }
            for (const id of Object.keys(next)) next[id] = { ...next[id], speaking: ids.has(id) }
            return next
          })
        })
        // Tells the teacher when a stutter is the student's own network.
        .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
          if (participant.isLocal) return
          upsertStream(participant.identity, { weak: quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost })
        })
        .on(RoomEvent.Disconnected, () => { if (!cancelled) setLiveStatus('error') })

      try {
        const res = await fetch('/api/proctor/live-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId, role: 'teacher' }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const { token, url } = await res.json()
        if (cancelled) return
        await live.connect(url, token)
        if (cancelled) return
        // Announce whom we watch BEFORE telling the students, so LiveKit
        // already knows when their token request arrives.
        await live.localParticipant.setAttributes({ [WATCHING_ATTRIBUTE]: watchRef.current })
        setLiveStatus('live')
        sendWatch()
      } catch (e) {
        console.error('[live-monitor]', e)
        if (!cancelled) setLiveStatus('error')
      }
    })()

    return () => {
      cancelled = true
      room?.disconnect().catch(() => {})
      roomRef.current = null
      for (const m of Object.values(mediaEls.current)) m.audio?.remove()
      mediaEls.current = {}
    }
  }, [liveOn, liveConfigured, examId, sendWatch, upsertStream])

  // Whenever the watch set changes: LiveKit first (it authorises streaming),
  // then the students.
  useEffect(() => {
    const room = roomRef.current
    let cancelled = false
    ;(async () => {
      if (room && liveStatus === 'live') {
        await room.localParticipant.setAttributes({ [WATCHING_ATTRIBUTE]: watchKey }).catch(() => {})
      }
      if (!cancelled) sendWatch()
    })()
    return () => { cancelled = true }
  }, [watchKey, liveStatus, sendWatch])

  // Teacher hears the watched students: one switch for all.
  useEffect(() => {
    for (const m of Object.values(mediaEls.current)) if (m.audio) m.audio.muted = muted
  }, [muted, streams])

  function startLive() {
    setLiveStatus('connecting')
    setLiveOn(true)
  }
  function stopLive() {
    setLiveOn(false)
    setLiveStatus('off')
    setStreams({})
    setZoomed(null)
  }
  function toggleWatch(id: string) {
    setWatching(prev => prev.includes(id)
      ? prev.filter(x => x !== id)
      : (prev.filter(x => present.has(x)).length >= MAX_WATCHED ? prev : [...prev, id]))
  }

  // Watched students first, then the most violations.
  const list = Object.entries(students)
    .map(([id, p]) => ({ id, ...p, watched: liveOn && watchingPresent.includes(id) }))
    .sort((a, b) => Number(b.watched) - Number(a.watched) || b.v - a.v || (names[a.id] ?? '').localeCompare(names[b.id] ?? ''))
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const zoomedItem = zoomed ? list.find(s => s.id === zoomed && s.watched) : undefined
  const visible = zoomedItem ? [zoomedItem] : list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const evidenceSignal = list.reduce((sum, s) => sum + s.ev, 0)
  const atLimit = watchingPresent.length >= MAX_WATCHED

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_20rem] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => router.push('/teacher/proctoring')} className="text-slate-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></button>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{t('title', { exam: examTitle })}</h2>
            <p className="text-slate-400 text-sm flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> {t('connected', { count: list.length })}
            </p>
          </div>
          {liveConfigured && (
            <button onClick={liveOn ? stopLive : startLive}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${liveOn ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>
              <Radio className="w-4 h-4" /> {liveOn ? t('liveStop') : t('liveStart')}
            </button>
          )}
          {liveOn && liveStatus === 'live' && (
            <button onClick={() => setMuted(m => !m)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${muted ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-emerald-600 text-white'}`}>
              {muted ? <><MicOff className="w-4 h-4" /> {t('mutedLabel')}</> : <><Volume2 className="w-4 h-4" /> {t('listeningLabel')}</>}
            </button>
          )}
        </div>

        {/* What is running right now, in one line */}
        <div className="flex items-start gap-2 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-slate-300">
            {!liveConfigured ? t('disabled') : liveOn ? t('liveHint', { max: MAX_WATCHED }) : t('liveIdle')}
          </p>
        </div>

        {channelStatus === 'connecting' && <p className="text-slate-500 text-sm py-8 text-center">{t('connecting')}</p>}
        {channelStatus === 'error' && <p className="text-red-400 text-sm py-8 text-center">{t('channelError')}</p>}
        {liveOn && liveStatus === 'error' && <p className="text-red-400 text-sm text-center">{t('error')}</p>}

        {channelStatus === 'ready' && list.length === 0 && (
          <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
            <Video className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">{t('noStudents')}</p>
            <p className="text-slate-500 text-sm mt-1">{t('noStudentsHint')}</p>
          </div>
        )}

        {liveOn && list.length > 0 && !zoomedItem && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              onClick={() => setWatching(prev => {
                const next = prev.filter(id => present.has(id))
                for (const s of visible) if (next.length < MAX_WATCHED && !next.includes(s.id)) next.push(s.id)
                return next
              })}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700">{t('watchPage')}</button>
            {watchingPresent.length > 0 && (
              <button onClick={() => setWatching([])} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700">{t('unwatchAll')}</button>
            )}
            <span className="text-slate-500">{t('watchingCount', { count: watchingPresent.length, max: MAX_WATCHED })}</span>
          </div>
        )}

        {zoomedItem && (
          <button onClick={() => setZoomed(null)} className="text-sm text-slate-400 hover:text-white flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" /> {t('backToWall')}
          </button>
        )}

        {list.length > 0 && (
          <div className={zoomedItem ? 'grid grid-cols-1' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'}>
            {
              // eslint-disable-next-line react-hooks/refs -- mediaEls holds imperative video DOM elements; reading .current during render is the correct pattern here (StudentTile receives the element as a prop and appends it via effect)
              visible.map(s => {
                const stream = streams[s.id]
                return (
                  <StudentTile key={s.id}
                    name={names[s.id] ?? '…'}
                    presence={s}
                    watched={s.watched}
                    liveOn={liveOn}
                    canWatch={!atLimit}
                    videoEl={s.watched ? mediaEls.current[s.id]?.video : undefined}
                    hasVideo={!!stream?.hasVideo}
                    speaking={!!stream?.speaking}
                    weak={!!stream?.weak}
                    zoomed={!!zoomedItem}
                    onToggleWatch={() => toggleWatch(s.id)}
                    onZoom={() => { if (s.watched) setZoomed(z => (z === s.id ? null : s.id)) }}
                  />
                )
              })
            }
          </div>
        )}

        {!zoomedItem && pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm disabled:opacity-40 hover:bg-slate-700">{t('prev')}</button>
            <span className="text-slate-400 text-sm">{t('pageOf', { page: safePage + 1, total: pageCount })}</span>
            <button disabled={safePage >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm disabled:opacity-40 hover:bg-slate-700">{t('next')}</button>
          </div>
        )}
      </div>

      <EvidencePanel examId={examId} refreshSignal={evidenceSignal} />
    </div>
  )
}

function StudentTile(props: {
  name: string
  presence: StudentPresence
  watched: boolean
  liveOn: boolean
  canWatch: boolean
  videoEl?: HTMLVideoElement
  hasVideo: boolean
  speaking: boolean
  weak: boolean
  zoomed: boolean
  onToggleWatch: () => void
  onZoom: () => void
}) {
  const { name, presence, watched, liveOn, canWatch, videoEl, hasVideo, speaking, weak, zoomed, onToggleWatch, onZoom } = props
  const t = useTranslations('teacher.live')
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = holder.current
    if (!el) return
    if (videoEl && videoEl.parentElement !== el) { el.innerHTML = ''; el.appendChild(videoEl) }
    if (!videoEl) el.innerHTML = ''
  }, [videoEl, hasVideo])

  return (
    <div
      className={`relative rounded-xl overflow-hidden border-2 bg-slate-950 transition-colors ${zoomed ? 'aspect-video max-h-[70vh] mx-auto w-full' : 'aspect-video'} ${speaking ? 'border-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.3)]' : watched ? 'border-blue-500/60' : 'border-slate-800'} ${watched ? 'cursor-pointer' : ''}`}
      onClick={onZoom}
      title={watched && !zoomed ? t('zoomHint') : ''}>
      <div ref={holder} className="absolute inset-0 flex items-center justify-center" />
      {!(watched && hasVideo) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-600">
          {watched ? <Video className="w-8 h-8 animate-pulse" /> : <VideoOff className="w-8 h-8" />}
          <span className="text-xs text-slate-500">{watched ? t('connectingStudent') : t('silentMonitoring')}</span>
        </div>
      )}

      <div className="absolute top-2 inset-x-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {presence.v > 0 && (
            <span className="flex items-center gap-1 bg-amber-500/90 text-black text-xs font-bold px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" /> {t('violationsCount', { count: presence.v })}
            </span>
          )}
          {presence.ev > 0 && (
            <span className="flex items-center gap-1 bg-slate-800/90 text-slate-100 text-xs font-bold px-2 py-0.5 rounded-full">
              <Camera className="w-3 h-3" /> {presence.ev}
            </span>
          )}
          {weak && watched && (
            <span className="flex items-center gap-1 bg-amber-500/90 text-black text-xs font-bold px-2 py-0.5 rounded-full">
              <WifiOff className="w-3 h-3" /> {t('weakConnection')}
            </span>
          )}
        </div>
        {speaking && (
          <span className="flex items-center gap-1 bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
            <Volume2 className="w-3 h-3" /> {t('speaking')}
          </span>
        )}
      </div>

      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-white text-sm font-medium truncate">{name}</span>
        {liveOn && (
          <button
            onClick={e => { e.stopPropagation(); onToggleWatch() }}
            disabled={!watched && !canWatch}
            title={!watched && !canWatch ? t('watchLimit', { max: MAX_WATCHED }) : ''}
            className={`shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md disabled:opacity-40 ${watched ? 'bg-red-600/90 text-white hover:bg-red-500' : 'bg-blue-600/90 text-white hover:bg-blue-500'}`}>
            {watched ? <><EyeOff className="w-3.5 h-3.5" /> {t('unwatch')}</> : <><Eye className="w-3.5 h-3.5" /> {t('watch')}</>}
          </button>
        )}
      </div>
    </div>
  )
}
