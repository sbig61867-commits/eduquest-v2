'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { BrandMark } from './brand-mark'

/**
 * Full-screen logo intro, played once after each sign-in before the first
 * dashboard shows, ending with the mark flying into its place in the sidebar.
 *
 * "Once per sign-in" = the INTRO_DONE_KEY localStorage flag: set when the
 * intro starts, cleared by signOutAndLeave() and by the sign-in page. New
 * tabs of the same session therefore do not replay it.
 *
 * Two ways in, both before first paint: a full page load runs INTRO_BOOT
 * (inline, like THEME_BOOT_SCRIPT), a client-side navigation from the sign-in
 * form runs the layout effect. Either sets <html data-eq-intro>, and CSS
 * (globals.css) shows the overlay and plays it. If this component never
 * hydrates, the CSS fades the overlay out by itself, so it can never trap
 * anyone. Skipped entirely under prefers-reduced-motion.
 */
export const INTRO_DONE_KEY = 'eq_intro_done'
const ATTR = 'data-eq-intro'
const HOLD_MS = 3300
const FLIGHT_MS = 750

const INTRO_BOOT =
  `try{if(!localStorage.getItem('${INTRO_DONE_KEY}')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.setAttribute('${ATTR}','')}catch(e){}`

// Fixed, not random: the markup is server-rendered and must hydrate as-is.
const SPARKS: [number, number][] = [
  [-42, -30], [38, -36], [-30, 34], [44, 26], [-48, 4], [50, -6], [-12, -46], [16, 44],
  [-36, -12], [30, 12], [-20, 40], [24, -44], [-46, 22], [40, -22],
]

export function BrandIntro() {
  const t = useTranslations('common.brandIntro')
  const markRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const done = useRef(false)

  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(INTRO_DONE_KEY)) return
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
      localStorage.setItem(INTRO_DONE_KEY, '1')
      document.documentElement.setAttribute(ATTR, '')
    } catch { /* storage blocked: no intro */ }
  }, [])

  const finish = useCallback(() => {
    if (done.current) return
    done.current = true
    const root = rootRef.current
    const mark = markRef.current
    const end = () => document.documentElement.removeAttribute(ATTR)
    if (!root || !mark) return end()
    root.classList.add('eq-intro-leaving')

    // Fly to the sidebar's mark when it is on screen (desktop, expanded);
    // otherwise to the top inline-start corner.
    const from = mark.getBoundingClientRect()
    const anchor = document.querySelector('[data-brand-anchor]')?.getBoundingClientRect()
    const visible = anchor && anchor.width > 0 && anchor.right > 0 && anchor.left < window.innerWidth
    const rtl = document.documentElement.dir === 'rtl'
    const to = visible ? anchor : { left: rtl ? window.innerWidth - 48 : 16, top: 16, width: 32 }
    const scale = to.width / from.width
    mark.animate(
      [{ transform: 'none' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})` }],
      { duration: FLIGHT_MS, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' },
    ).finished.then(end, end)
  }, [])

  useEffect(() => {
    if (!document.documentElement.hasAttribute(ATTR)) return
    try { localStorage.setItem(INTRO_DONE_KEY, '1') } catch { /* ignore */ }
    const timer = setTimeout(finish, HOLD_MS)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey) }
  }, [finish])

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT }} />
      <div ref={rootRef} className="eq-intro" onClick={finish} aria-hidden="true">
        <div className="eq-intro-bg bg-slate-950" />
        <div className="eq-intro-stage">
          <div className="eq-intro-sparks">
            {SPARKS.map(([x, y], i) => (
              <span key={i} style={{ '--x': `${x}vmin`, '--y': `${y}vmin`, '--d': `${i * 25}ms` } as React.CSSProperties}
                className={i % 4 ? 'bg-blue-400' : 'eq-intro-gold'} />
            ))}
          </div>
          <div ref={markRef} className="eq-intro-mark"><BrandMark size={128} /></div>
          <p dir="ltr" className="eq-intro-word text-white">EduQuest</p>
        </div>
      </div>
      <button type="button" onClick={finish} className="eq-intro-skip text-slate-300 hover:text-white border border-slate-700">
        {t('skip')}
      </button>
    </>
  )
}
