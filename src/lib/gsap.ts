'use client'

import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

/**
 * Single entry point for GSAP.
 *
 * Plugins have to be registered exactly once, and only in the browser: GSAP
 * touches `document` at register time, so importing this from a server
 * component would throw during the render. Every file that animates imports
 * `gsap` from here rather than from the package, which keeps the registration
 * in one place and makes it obvious where the animation layer lives.
 *
 * Scope: the marketing pages only. The signed-in application animates with
 * framer-motion, and mixing the two inside one component is how a codebase ends
 * up with two half-migrated animation systems.
 */
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)

  // Respect the OS setting globally instead of guarding every call site. With
  // this matchMedia context, animations defined inside `prefersMotion()` below
  // simply never build when the user has asked for reduced motion, and GSAP
  // reverts anything already applied.
  ScrollTrigger.config({ ignoreMobileResize: true })
}

/**
 * Runs `build` only for viewers who have not asked for reduced motion, and
 * hands back a cleanup function for React effects. Anything the callback
 * creates is reverted automatically, so a component unmount cannot leave a
 * dangling ScrollTrigger behind.
 *
 *   useEffect(() => prefersMotion(() => {
 *     gsap.from('.card', { y: 24, opacity: 0, stagger: 0.08 })
 *   }, ref), [])
 */
export function prefersMotion(build: () => void, scope?: React.RefObject<HTMLElement | null>) {
  const ctx = gsap.context(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    build()
  }, scope?.current ?? undefined)

  return () => ctx.revert()
}

export { gsap, ScrollTrigger }
