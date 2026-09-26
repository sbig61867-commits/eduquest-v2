'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Megaphone, ChevronLeft, ChevronRight, ExternalLink, MessageCircle, Phone, Mail, Pin, Clock, Hand, Check } from 'lucide-react'
import { parseContactUrl, isWebUrl } from '@/lib/announcement-contact'
import { toast } from '@/components/ui/toast'

// Motion announcement banner on the student home. Pure CSS/RAF-free:
// a cross-fading slide with an auto-advance timer, a subtle entrance
// animation and a progress bar — no animation library (keeps the bundle
// small and costs nothing).
//
// Also rendered on the teacher dashboard and as the live preview in the
// admin / centre announcement editors, so its strings live in `common`
// (every route group loads it) — under `student.*` they rendered as raw
// message keys everywhere but the student area.

export interface StudentAnnouncement {
  id: string
  title: string
  body: string | null
  image_url: string | null
  link_url: string | null
  cta_label: string | null
  /** The fields below come from announcement_engagement_migration.sql; absent before it. */
  ends_at?: string | null
  pinned?: boolean
  collect_interest?: boolean
  interested?: boolean
}

const ROTATE_MS = 7000
const VIEWED_KEY = 'eq-announcements-viewed'

/** Fire-and-forget engagement event. `keepalive` lets a click survive the navigation it triggers. */
function sendEvent(id: string, kind: 'view' | 'click' | 'interest', method: 'POST' | 'DELETE' = 'POST') {
  return fetch('/api/announcements/events', {
    method,
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, kind }),
  })
}

/** Records one view per announcement per browser session. */
function markViewed(id: string) {
  try {
    const seen: string[] = JSON.parse(sessionStorage.getItem(VIEWED_KEY) ?? '[]')
    if (seen.includes(id)) return
    sessionStorage.setItem(VIEWED_KEY, JSON.stringify([...seen, id].slice(-200)))
  } catch { /* storage unavailable: the unique index still dedupes server-side */ }
  sendEvent(id, 'view').catch(() => {})
}

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

/** The body with its web links made clickable (http/https only). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1
        ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline break-all">{part}</a>
        : <span key={i}>{part}</span>))}
    </>
  )
}

/** "Ends in …" when the announcement closes within three days. */
function endsSoon(endsAt: string | null | undefined): { hours: number } | null {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  if (!(ms > 0) || ms > 3 * 24 * 3600 * 1000) return null
  return { hours: Math.max(1, Math.ceil(ms / 3600000)) }
}

export function AnnouncementsBanner({ announcements, track = false, preview = false }: {
  announcements: StudentAnnouncement[]
  /** The viewer is the student it is addressed to: record views/clicks and allow "I'm interested". */
  track?: boolean
  /** Editor preview: show the interest button as the student will see it, inert. */
  preview?: boolean
}) {
  const t = useTranslations('common.announcementBanner')
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [interest, setInterest] = useState<Record<string, boolean>>({})
  const [interestBusy, setInterestBusy] = useState(false)
  const router = useRouter()

  const count = announcements.length

  // A shorter list (a popup dismissal, a deleted announcement) must not
  // leave the index pointing past the end.
  const safeIndex = count ? index % count : 0

  useEffect(() => {
    if (count <= 1 || paused || expanded) return
    const t = setTimeout(() => setIndex(i => (i + 1) % count), ROTATE_MS)
    return () => clearTimeout(t)
  }, [index, count, paused, expanded])

  const currentId = count ? announcements[safeIndex].id : null
  useEffect(() => {
    if (track && currentId) markViewed(currentId)
  }, [track, currentId])

  if (count === 0) return null
  const a = announcements[safeIndex]
  const isInterested = interest[a.id] ?? a.interested === true
  const soon = endsSoon(a.ends_at)

  async function toggleInterest() {
    if (!track || interestBusy) return
    setInterestBusy(true)
    const next = !isInterested
    try {
      const res = await sendEvent(a.id, 'interest', next ? 'POST' : 'DELETE')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? t('interestFailed')); return }
      setInterest(m => ({ ...m, [a.id]: next }))
      if (next) toast.success(t('interestSaved'))
      // The popup and the dashboard each render the feed; refresh so both agree.
      router.refresh()
    } catch {
      toast.error(t('interestFailed'))
    } finally {
      setInterestBusy(false)
    }
  }
  const longBody = !!a.body && (a.body.length > 220 || a.body.split('\n').length > 3)

  function go(i: number) {
    setExpanded(false)
    setIndex(i)
  }

  return (
    <div
      dir="auto"
      className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* animated sheen */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] eq-sheen" aria-hidden />

      <div key={a.id} className="eq-fade-in">
        {a.image_url && <AnnouncementImage src={a.image_url} zoomable />}

        <div className="p-5 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Megaphone className="w-3 h-3" /> {t('badge')}
            </span>
            {a.pinned && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                <Pin className="w-3 h-3" /> {t('pinned')}
              </span>
            )}
            {soon && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                <Clock className="w-3 h-3" />
                {soon.hours < 24 ? t('endsInHours', { count: soon.hours }) : t('endsInDays', { count: Math.ceil(soon.hours / 24) })}
              </span>
            )}
          </div>

          <h3 className="text-white text-lg font-bold leading-snug break-words">{a.title}</h3>
          {a.body && (
            <p className={`text-slate-300 text-sm mt-1.5 whitespace-pre-line break-words ${expanded ? '' : 'line-clamp-3'}`}><Linkified text={a.body} /></p>
          )}
          {longBody && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-blue-400 hover:text-blue-300 text-xs font-medium mt-1"
            >{expanded ? t('less') : t('more')}</button>
          )}

          {(a.link_url || (a.collect_interest && (track || preview))) && (
            <div className="flex items-center gap-2 flex-wrap">
              {a.link_url && (
                <CtaButton url={a.link_url} label={a.cta_label?.trim() || ''} t={t}
                  onClick={track ? () => { sendEvent(a.id, 'click').catch(() => {}) } : undefined} />
              )}
              {a.collect_interest && (track || preview) && (
                <button
                  type="button"
                  onClick={toggleInterest}
                  disabled={interestBusy}
                  aria-pressed={isInterested}
                  className={`inline-flex items-center gap-1.5 mt-3 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors disabled:opacity-60 ${
                    isInterested
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                      : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700'
                  }`}
                >
                  {isInterested ? <Check className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}
                  {isInterested ? t('interestedOn') : t('interested')}
                </button>
              )}
            </div>
          )}
          {a.collect_interest && isInterested && track && (
            <p className="text-emerald-400/80 text-xs mt-1.5">{t('interestNote')}</p>
          )}
        </div>
      </div>

      {count > 1 && (
        <>
          <div className="flex items-center justify-between px-4 pb-3">
            <div className="flex gap-1.5">
              {announcements.map((item, i) => (
                <button
                  key={item.id}
                  onClick={() => go(i)}
                  aria-label={t('slide', { n: i + 1 })}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === safeIndex ? 'w-6 bg-blue-500' : 'w-1.5 bg-slate-600 hover:bg-slate-500'
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => go((safeIndex - 1 + count) % count)}
                aria-label={t('prev')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              ><ChevronRight className="w-4 h-4" /></button>
              <button
                onClick={() => go((safeIndex + 1) % count)}
                aria-label={t('next')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              ><ChevronLeft className="w-4 h-4" /></button>
            </div>
          </div>

          {/* auto-advance progress */}
          {!paused && !expanded && (
            <div
              key={`bar-${safeIndex}`}
              className="absolute bottom-0 end-0 h-0.5 bg-blue-500/70 eq-progress"
              style={{ animationDuration: `${ROTATE_MS}ms` }}
            />
          )}
        </>
      )}

      <style jsx>{`
        .eq-fade-in {
          animation: eqFadeIn 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes eqFadeIn {
          from { opacity: 0; transform: translateY(8px) scale(0.995); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        .eq-progress {
          animation: eqProgress linear forwards;
        }
        @keyframes eqProgress {
          from { width: 0%; }
          to   { width: 100%; }
        }
        .eq-sheen {
          background: linear-gradient(115deg, transparent 30%, #fff 50%, transparent 70%);
          background-size: 200% 100%;
          animation: eqSheen 6s linear infinite;
        }
        @keyframes eqSheen {
          from { background-position: 200% 0; }
          to   { background-position: -100% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .eq-fade-in, .eq-progress, .eq-sheen { animation: none; }
        }
      `}</style>
    </div>
  )
}

/**
 * The whole image, never cropped. The old layout squeezed a 1200×400 designer
 * banner into a 224px side column with object-cover, so most of the banner
 * (its text included) was cut off by the frame. The image now spans the full
 * card width at its own aspect ratio; a blurred copy fills the letterbox when
 * a photo is taller than the height cap.
 */
export function AnnouncementImage({ src, className = 'max-h-[22rem]', zoomable = false }: {
  src: string
  className?: string
  /** Tapping opens the original at full size — useful for tall posters shown scaled down. */
  zoomable?: boolean
}) {
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className={`relative block w-full h-auto object-contain mx-auto ${className}`} />
    </>
  )
  return zoomable
    ? <a href={src} target="_blank" rel="noopener noreferrer" className="relative block w-full overflow-hidden bg-slate-950 cursor-zoom-in">{inner}</a>
    : <div className="relative w-full overflow-hidden bg-slate-950">{inner}</div>
}

function CtaButton({ url, label, t, onClick }: { url: string; label: string; t: (key: string) => string; onClick?: () => void }) {
  const { type } = parseContactUrl(url)
  const web = isWebUrl(url)
  const Icon = type === 'whatsapp' ? MessageCircle : type === 'phone' ? Phone : type === 'email' ? Mail : ExternalLink
  const color = type === 'whatsapp' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'
  const fallback = type === 'link' ? t('learnMore') : t(`contact.${type}`)
  return (
    <a
      href={url}
      {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 mt-3 text-sm font-medium px-3.5 py-2 rounded-lg text-white transition-colors ${color}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label || fallback}
    </a>
  )
}
