'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { BrandMark } from './brand-mark'
import { INTRO_DONE_KEY } from '@/lib/brand-intro-key'

/**
 * Short logo intro, played once after each sign-in before the first dashboard
 * shows, ending with the mark flying into its place in the sidebar.
 *
 * Sequence (globals.css `.eq-intro-run`, ~1.8 s in all): the tile pops · the E
 * rises from its baseline and extrudes · the leather cap drops on with a small
 * bounce · the E lifts its head · the wordmark slides in · the mark flies to
 * [data-brand-anchor]. After that the mark never moves (owner's rule).
 *
 * Deliberately light (owner, 2026-09-29: the particle version stuttered on
 * phones and read as a glitch): CSS keyframes only, and only `transform` /
 * `opacity`, which the browser runs on the compositor — no per-frame
 * JavaScript, no particles, no animated gradients or clip-paths. The whole
 * overlay is gone ~1.8 s after the dashboard is ready (it was 4.6 s).
 *
 * "Once per sign-in" = the INTRO_DONE_KEY localStorage flag: set when the
 * intro starts, cleared by signOutAndLeave() and by the sign-in page. New
 * tabs of the same session therefore do not replay it.
 *
 * Two ways in, both before first paint: a full page load runs INTRO_BOOT
 * (inline, like THEME_BOOT_SCRIPT), a client-side navigation from the sign-in
 * form runs the layout effect. Either sets <html data-eq-intro>, which shows
 * the overlay (globals.css). If this component never hydrates, CSS fades the
 * overlay out by itself, so it can never trap anyone. Skipped entirely under
 * prefers-reduced-motion. Tap anywhere or press Esc to skip.
 */
export { INTRO_DONE_KEY }
const ATTR = 'data-eq-intro'
const HOLD_MS = 1350
const FLIGHT_MS = 450

const INTRO_BOOT =
  `try{if(!localStorage.getItem('${INTRO_DONE_KEY}')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.setAttribute('${ATTR}','')}catch(e){}`

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
    // A hidden tab pauses animations, so `finished` may never arrive; the
    // timer guarantees the overlay (and its scroll lock) always goes away.
    setTimeout(end, FLIGHT_MS + 150)
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
    const root = rootRef.current
    if (!root || !document.documentElement.hasAttribute(ATTR)) return
    try { localStorage.setItem(INTRO_DONE_KEY, '1') } catch { /* ignore */ }
    root.classList.add('eq-intro-run')

    const timer = setTimeout(finish, HOLD_MS)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKey)
    }
  }, [finish])

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT }} />
      <div ref={rootRef} className="eq-intro" onClick={finish} aria-hidden="true">
        <div className="eq-intro-bg bg-slate-950" />
        <div className="eq-intro-stage">
          <div ref={markRef} className="eq-intro-mark">
            <BrandMark size={112} />
          </div>
          <p dir="ltr" className="eq-intro-word eq-wordmark">EduQuest</p>
        </div>
      </div>
      <button type="button" onClick={finish} className="eq-intro-skip text-slate-300 hover:text-white border border-slate-700">
        {t('skip')}
      </button>
    </>
  )
}
