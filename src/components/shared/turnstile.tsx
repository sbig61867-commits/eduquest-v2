'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useLocale } from 'next-intl'

// Cloudflare Turnstile, the CAPTCHA that Supabase Auth checks once its bot
// protection is on (Dashboard → Authentication → Bot and Abuse Protection).
// Supabase verifies the token itself; the app only carries it to the sign-in,
// reset or password-check call. Without NEXT_PUBLIC_TURNSTILE_SITE_KEY this
// renders nothing and every token is undefined, which Supabase accepts while
// its protection is off, so the code can ship before the switch is flipped.
//
// 'interaction-only': most visitors never see a widget; it appears only when
// Cloudflare wants a click. The script loads on the auth pages alone.

// NEXT_PUBLIC_ values are inlined at build time: changing the key needs a rebuild.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
const SCRIPT_SRC ='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
/** How long a submit waits for a token Turnstile has not produced yet. */
const TOKEN_WAIT_MS = 15_000

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}
declare global { interface Window { turnstile?: TurnstileApi } }

let scriptPromise: Promise<TurnstileApi> | null = null
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile unavailable')))
    s.onerror = () => { scriptPromise = null; reject(new Error('turnstile unavailable')) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export interface TurnstileHandle {
  /**
   * Hands over the current token and starts on the next one: a token is
   * single-use, so a retry after a wrong password needs a fresh one. Waits
   * briefly for a token still in flight; undefined when Turnstile is off.
   */
  take(): Promise<string | undefined>
}

export const Turnstile = forwardRef<TurnstileHandle, { className?: string }>(function Turnstile({ className }, ref) {
  const locale = useLocale()
  const boxRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<string | null>(null)
  const tokenRef = useRef<string | undefined>(undefined)
  const waitersRef = useRef<((token: string | undefined) => void)[]>([])

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !boxRef.current) return
    let cancelled = false
    const settle = (token: string | undefined) => {
      tokenRef.current = token
      for (const wake of waitersRef.current.splice(0)) wake(token)
    }
    loadTurnstile().then(api => {
      if (cancelled || !boxRef.current) return
      widgetRef.current = api.render(boxRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        language: locale,
        theme: 'auto',
        size: 'flexible',
        appearance: 'interaction-only',
        callback: (token: string) => settle(token),
        'expired-callback': () => { tokenRef.current = undefined },
      })
    }).catch(() => settle(undefined))
    return () => {
      cancelled = true
      if (widgetRef.current) window.turnstile?.remove(widgetRef.current)
      widgetRef.current = null
      tokenRef.current = undefined
    }
  }, [locale])

  useImperativeHandle(ref, () => ({
    async take() {
      if (!TURNSTILE_SITE_KEY) return undefined
      const token = tokenRef.current ?? await new Promise<string | undefined>(resolve => {
        const wake = (t: string | undefined) => { clearTimeout(timer); resolve(t) }
        const timer = setTimeout(() => {
          waitersRef.current = waitersRef.current.filter(w => w !== wake)
          resolve(undefined)
        }, TOKEN_WAIT_MS)
        waitersRef.current.push(wake)
      })
      tokenRef.current = undefined
      if (widgetRef.current) window.turnstile?.reset(widgetRef.current)
      return token
    },
  }), [])

  if (!TURNSTILE_SITE_KEY) return null
  return <div ref={boxRef} className={className} />
})
