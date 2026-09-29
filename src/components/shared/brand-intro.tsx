'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { BrandMark, TASSEL_REST, tasselGeometry } from './brand-mark'

/**
 * Full-screen logo intro, played once after each sign-in before the first
 * dashboard shows, ending with the mark flying into its place in the sidebar.
 *
 * Sequence (t = 0 when the component starts it, globals.css `.eq-intro-run`):
 * tile pops · particles spiral in from every side and condense into the E ·
 * the E turns solid and extrudes · the leather cap drops on · the E lifts its
 * head · the tassel swings on a damped pendulum until it hangs still · the
 * wordmark is revealed · the mark flies to [data-brand-anchor]. After that the
 * mark never moves (owner's rule).
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
 * prefers-reduced-motion.
 */
export const INTRO_DONE_KEY = 'eq_intro_done'
const ATTR = 'data-eq-intro'
const HOLD_MS = 3900
const FLIGHT_MS = 750
const TASSEL_KICKS: [number, number][] = [[2450, 5.5], [2650, -3]] // [ms, rad/s]

const INTRO_BOOT =
  `try{if(!localStorage.getItem('${INTRO_DONE_KEY}')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.setAttribute('${ATTR}','')}catch(e){}`

// Where the particles land: a fixed grid over the E (spine + three arms), so
// the server-rendered markup hydrates as-is. Every 7th is gold.
const PARTICLES: [number, number][] = []
for (const [x0, y0, w, h] of [[18, 25, 8, 30], [26, 25, 17, 7], [26, 36.5, 12, 6.5], [26, 48, 17, 7]]) {
  for (let x = x0 + 1; x < x0 + w; x += 2.3) {
    for (let y = y0 + 1; y < y0 + h; y += 2.3) PARTICLES.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10])
  }
}

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

    // Particles: each spirals in from a random point around the mark.
    const particles = [...root.querySelectorAll<SVGElement>('.eq-bm-particle')]
    for (const p of particles) {
      const a = Math.random() * Math.PI * 2
      const r = 40 + Math.random() * 25
      const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360)
      p.animate([
        { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) rotate(${spin}deg) scale(.4)`, opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { transform: 'none', opacity: 1 },
      ], { duration: 1100, delay: 300 + Math.random() * 300, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'both' })
      p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 1750, fill: 'forwards' })
    }

    // Tassel: a damped pendulum, kicked when the cap lands and when the head lifts.
    const tassel = root.querySelector('.eq-bm-tassel')
    const cord = tassel?.querySelector('.eq-bm-cord')
    const knot = tassel?.querySelector('.eq-bm-knot')
    const fringe = tassel ? [...tassel.querySelectorAll('.eq-bm-fringe')] : []
    let theta = TASSEL_REST - 0.9
    let omega = 0
    let raf = 0
    let last = 0
    const draw = () => {
      const geo = tasselGeometry(theta, omega)
      cord?.setAttribute('d', geo.cord)
      knot?.setAttribute('cx', String(geo.knot.cx))
      knot?.setAttribute('cy', String(geo.knot.cy))
      fringe.forEach((l, i) => {
        const s = geo.fringe[i]
        l.setAttribute('x1', String(s.x1)); l.setAttribute('y1', String(s.y1))
        l.setAttribute('x2', String(s.x2)); l.setAttribute('y2', String(s.y2))
      })
    }
    const step = (now: number) => {
      const dt = Math.min(0.03, (now - last) / 1000)
      last = now
      omega += (-55 * Math.sin(theta - TASSEL_REST) - 2.6 * omega) * dt
      theta += omega * dt
      if (Math.abs(omega) < 0.02 && Math.abs(theta - TASSEL_REST) < 0.004) {
        theta = TASSEL_REST; omega = 0; draw(); raf = 0; return
      }
      draw()
      raf = requestAnimationFrame(step)
    }
    draw()
    const timers = TASSEL_KICKS.map(([ms, kick]) => setTimeout(() => {
      omega += kick
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(step) }
    }, ms))

    timers.push(setTimeout(finish, HOLD_MS))
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    document.addEventListener('keydown', onKey)
    return () => {
      timers.forEach(clearTimeout)
      cancelAnimationFrame(raf)
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
            <BrandMark size={128}>
              {PARTICLES.map(([x, y], i) => (
                <rect key={i} className="eq-bm-particle" x={x - 0.9} y={y - 0.9} width="1.8" height="1.8" rx=".4"
                  fill={i % 7 ? '#e0f2fe' : '#fde68a'} />
              ))}
            </BrandMark>
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
