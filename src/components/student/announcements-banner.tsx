'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Megaphone, ChevronLeft, ChevronRight, ExternalLink, MessageCircle, Phone, Mail } from 'lucide-react'
import { parseContactUrl, isWebUrl } from '@/lib/announcement-contact'

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
}

const ROTATE_MS = 7000

export function AnnouncementsBanner({ announcements }: { announcements: StudentAnnouncement[] }) {
  const t = useTranslations('common.announcementBanner')
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const count = announcements.length

  // A shorter list (a popup dismissal, a deleted announcement) must not
  // leave the index pointing past the end.
  const safeIndex = count ? index % count : 0

  useEffect(() => {
    if (count <= 1 || paused || expanded) return
    const t = setTimeout(() => setIndex(i => (i + 1) % count), ROTATE_MS)
    return () => clearTimeout(t)
  }, [index, count, paused, expanded])

  if (count === 0) return null
  const a = announcements[safeIndex]
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
        {a.image_url && <AnnouncementImage src={a.image_url} />}

        <div className="p-5 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Megaphone className="w-3 h-3" /> {t('badge')}
            </span>
          </div>

          <h3 className="text-white text-lg font-bold leading-snug break-words">{a.title}</h3>
          {a.body && (
            <p className={`text-slate-300 text-sm mt-1.5 whitespace-pre-line break-words ${expanded ? '' : 'line-clamp-3'}`}>{a.body}</p>
          )}
          {longBody && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-blue-400 hover:text-blue-300 text-xs font-medium mt-1"
            >{expanded ? t('less') : t('more')}</button>
          )}

          {a.link_url && (
            <div>
              <CtaButton url={a.link_url} label={a.cta_label?.trim() || ''} t={t} />
            </div>
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
export function AnnouncementImage({ src, className = 'max-h-[22rem]' }: { src: string; className?: string }) {
  return (
    <div className="relative w-full overflow-hidden bg-slate-950">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className={`relative block w-full h-auto object-contain mx-auto ${className}`} />
    </div>
  )
}

function CtaButton({ url, label, t }: { url: string; label: string; t: (key: string) => string }) {
  const { type } = parseContactUrl(url)
  const web = isWebUrl(url)
  const Icon = type === 'whatsapp' ? MessageCircle : type === 'phone' ? Phone : type === 'email' ? Mail : ExternalLink
  const color = type === 'whatsapp' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'
  const fallback = type === 'link' ? t('learnMore') : t(`contact.${type}`)
  return (
    <a
      href={url}
      {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`inline-flex items-center gap-1.5 mt-3 text-sm font-medium px-3.5 py-2 rounded-lg text-white transition-colors ${color}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label || fallback}
    </a>
  )
}
