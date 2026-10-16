'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useAuthStore } from '@/stores/auth-store'
import { firstName } from '@/lib/first-name'
import { runLeafWelcome } from '@/lib/leaf-welcome'
import { INTRO_DONE_KEY } from '@/lib/brand-intro-key'

/**
 * The welcome played once after each sign-in, before the first dashboard
 * shows: a body of golden maple leaves walks across the screen, sheds leaves
 * that drift down everywhere, and the leaves then write "Welcome" and the
 * user's first name, melting into clean text (src/lib/leaf-welcome.ts).
 * It replaced the animated logo (owner, 2026-10-10: no logo at sign-in).
 *
 * The name: AuthProvider loads the signed-in row of public.users into the
 * auth store. The store is persisted, so on a shared device it can still hold
 * the previous account for a moment — the name is read only once the store
 * reports `isLoading === false` for this session, and the welcome greets
 * without a name rather than ever show the wrong one.
 *
 * "Once per sign-in" = the INTRO_DONE_KEY localStorage flag: set when the
 * welcome starts, cleared by signOutAndLeave() and by the sign-in page. New
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
const LEAVE_MS = 450

const INTRO_BOOT =
  `try{if(!localStorage.getItem('${INTRO_DONE_KEY}')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.setAttribute('${ATTR}','')}catch(e){}`

export function BrandIntro() {
  const t = useTranslations('common.brandIntro')
  const greeting = t('greeting')
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stopRef = useRef<() => void>(() => {})
  const done = useRef(false)

  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(INTRO_DONE_KEY)) return
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
      localStorage.setItem(INTRO_DONE_KEY, '1')
      document.documentElement.setAttribute(ATTR, '')
    } catch { /* storage blocked: no welcome */ }
  }, [])

  const finish = useCallback(() => {
    if (done.current) return
    done.current = true
    rootRef.current?.classList.add('eq-intro-leaving')
    // Always lift the overlay (and its scroll lock), even in a hidden tab.
    setTimeout(() => {
      document.documentElement.removeAttribute(ATTR)
      stopRef.current()
    }, LEAVE_MS)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas || !document.documentElement.hasAttribute(ATTR)) return
    try { localStorage.setItem(INTRO_DONE_KEY, '1') } catch { /* ignore */ }
    root.classList.add('eq-intro-run')

    stopRef.current = runLeafWelcome(canvas, {
      greeting,
      isReady: () => !useAuthStore.getState().isLoading,
      getName: () => firstName(useAuthStore.getState().user?.full_name),
      rtl: document.documentElement.dir === 'rtl',
      light: document.documentElement.dataset.eqTheme === 'light',
      onDone: finish,
    })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    document.addEventListener('keydown', onKey)
    return () => {
      stopRef.current()
      document.removeEventListener('keydown', onKey)
    }
  }, [finish, greeting])

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT }} />
      <div ref={rootRef} className="eq-intro" onClick={finish} aria-hidden="true">
        <div className="eq-intro-bg bg-canvas" />
        <canvas ref={canvasRef} className="eq-intro-canvas" />
      </div>
      <button type="button" onClick={finish} className="eq-intro-skip text-fg-3 hover:text-fg border border-line-strong">
        {t('skip')}
      </button>
    </>
  )
}
