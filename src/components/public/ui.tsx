'use client'

import Link from 'next/link'

// Shared building blocks of the public pages (landing, features, pricing,
// about, security, AI). Pure presentation: every string comes from the caller,
// so the i18n ratchet never sees a literal here. The light/dark appearance is
// handled by the `.eq-public` palette remap (src/app/globals.css).

/** Wide container: the page fills large screens instead of a narrow column. */
export const WRAP = 'max-w-[88rem] mx-auto px-4 sm:px-8 lg:px-12'
export const PANEL = 'rounded-3xl border border-slate-800 bg-slate-900/60'
/**
 * A reserved frame for a future photograph or video. With `src` it shows the
 * image; without one it holds the space with a quiet framed surface, so the
 * layout does not shift when real media arrives.
 */
export function MediaSlot({ src, alt = '' }: { src?: string; alt?: string }) {
  return (
    <figure className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- placeholder until real media is chosen
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true" className="absolute inset-3 rounded-md border border-dashed border-slate-700" />
      )}
    </figure>
  )
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-blue-400 text-sm font-semibold tracking-wide mb-3">{children}</p>
}

export function SectionHead({ eyebrow, title, desc, center }: { eyebrow?: string; title: string; desc?: string; center?: boolean }) {
  return (
    <div className={`mb-10 sm:mb-12 max-w-3xl ${center ? 'text-center mx-auto' : ''}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="text-2xl sm:text-4xl font-bold text-white leading-snug">{title}</h2>
      {desc && <p className="text-slate-400 mt-4 text-base sm:text-lg leading-relaxed">{desc}</p>}
    </div>
  )
}

/** Segmented control shared by the two-state demos. */
export function Segmented({ options, value, onChange, label }: { options: string[]; value: number; onChange: (i: number) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 p-1 rounded-2xl bg-slate-950/70 border border-slate-800">
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          aria-pressed={i === value}
          onClick={() => onChange(i)}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            i === value ? 'bg-blue-600 text-on-accent' : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

/** A check mark drawn in CSS (the public pages carry no icon font). */
export function CheckDot({ tone = 'bg-blue-600' }: { tone?: string }) {
  return (
    <span aria-hidden="true" className={`mt-0.5 flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${tone}`}>
      <span className="block w-1.5 h-2.5 -mt-0.5 border-b-2 border-r-2 border-on-accent rotate-45" />
    </span>
  )
}

/** Top-of-page hero used by every inner public page. */
export function PageHero({ eyebrow, title, desc, children }: { eyebrow: string; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <section className="relative">
      <div className={`relative ${WRAP} pt-14 sm:pt-20 pb-12 sm:pb-16 text-start`}>
        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/25 text-blue-300 text-sm font-medium">
          {eyebrow}
        </span>
        <h1 className="mt-7 text-3xl sm:text-5xl font-extrabold text-white leading-tight max-w-4xl">{title}</h1>
        <p className="text-slate-400 text-base sm:text-lg mt-6 max-w-3xl leading-loose">{desc}</p>
        {children}
      </div>
    </section>
  )
}

/** Closing call to action shared by the inner pages. */
export function CtaBand({ title, desc, primary, secondary }: {
  title: string
  desc: string
  primary: { label: string; href: string }
  secondary?: { label: string; href: string }
}) {
  return (
    <section className={`${WRAP} py-12 sm:py-16`}>
      <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900 px-6 py-14 sm:p-16 text-start">
        <div className="relative">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">{title}</h2>
          <p className="text-slate-300 mt-4 max-w-2xl leading-relaxed">{desc}</p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-9">
            <Link href={primary.href} className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-on-accent font-semibold transition-colors text-center">
              {primary.label}
            </Link>
            {secondary && (
              <Link href={secondary.href} className="w-full sm:w-auto px-8 py-3.5 rounded-xl border border-slate-600 hover:border-slate-400 text-slate-100 font-semibold transition-colors">
                {secondary.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

/** Two-column FAQ accordion (topic titles, not questions: see the copy rules). */
export function FaqGrid({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="grid md:grid-cols-2 gap-3 items-start">
      {items.map(f => (
        <details key={f.q} className="group rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden open:border-blue-500/40">
          <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none text-white font-medium hover:bg-slate-800/40 transition-colors [&::-webkit-details-marker]:hidden">
            {f.q}
            <span aria-hidden="true" className="relative w-3.5 h-3.5 shrink-0">
              <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-slate-400 rounded" />
              <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-slate-400 rounded transition-transform group-open:rotate-90 group-open:opacity-0" />
            </span>
          </summary>
          <p className="px-5 pb-5 -mt-1 text-slate-400 text-sm leading-relaxed">{f.a}</p>
        </details>
      ))}
    </div>
  )
}
