'use client'

import { useEffect, useState } from 'react'
import { Megaphone, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'

// Motion announcement banner on the student home. Pure CSS/RAF-free:
// a cross-fading slide with an auto-advance timer, a subtle entrance
// animation and a progress bar — no animation library (keeps the bundle
// small and costs nothing).

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
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const count = announcements.length

  useEffect(() => {
    if (count <= 1 || paused) return
    const t = setTimeout(() => setIndex(i => (i + 1) % count), ROTATE_MS)
    return () => clearTimeout(t)
  }, [index, count, paused])

  if (count === 0) return null
  const a = announcements[index]

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-lg border border-accent-border bg-elevated bg-[linear-gradient(135deg,var(--color-accent-subtle),var(--color-elevated)_65%)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* animated sheen */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] eq-sheen" aria-hidden />

      <div key={a.id} className="eq-fade-in flex flex-col sm:flex-row items-stretch gap-0">
        {a.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={a.image_url}
            alt=""
            className="sm:w-56 h-36 sm:h-auto w-full object-cover shrink-0"
          />
        )}

        <div className="p-5 flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-warning-subtle text-warning border border-warning/30">
              <Megaphone className="w-3 h-3" /> إعلان
            </span>
          </div>

          <h3 className="text-fg text-lg font-bold leading-snug">{a.title}</h3>
          {a.body && <p className="text-fg-secondary text-sm mt-1.5 line-clamp-3">{a.body}</p>}

          {a.link_url && (
            <a
              href={a.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium px-3.5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg transition-colors"
            >
              {a.cta_label?.trim() || 'اعرف المزيد'}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
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
                  onClick={() => setIndex(i)}
                  aria-label={`الإعلان ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? 'w-6 bg-accent' : 'w-1.5 bg-border-strong hover:bg-border'
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setIndex(i => (i - 1 + count) % count)}
                aria-label="السابق"
                className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface transition-colors"
              ><ChevronRight className="w-4 h-4" /></button>
              <button
                onClick={() => setIndex(i => (i + 1) % count)}
                aria-label="التالي"
                className="p-1.5 rounded-lg text-fg-secondary hover:text-fg hover:bg-surface transition-colors"
              ><ChevronLeft className="w-4 h-4" /></button>
            </div>
          </div>

          {/* auto-advance progress */}
          {!paused && (
            <div
              key={`bar-${index}`}
              className="absolute bottom-0 right-0 h-0.5 bg-accent/70 eq-progress"
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
