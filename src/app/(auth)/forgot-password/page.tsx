'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AuthTopBar } from '@/components/public/auth-top-bar'
import { Turnstile, type TurnstileHandle } from '@/components/shared/turnstile'

// Account recovery. Same public look as sign-in (`.eq-public`, light/dark),
// told as a journey instead: a three-stage track, an envelope that opens once
// the message is on its way, and a countdown ring before another link can be
// requested. Accent: sky.

/** Client-side pause before another link can be requested (spam guard). */
const RESEND_SECONDS = 60
const RING = 2 * Math.PI * 26

function Envelope({ open }: { open: boolean }) {
  return (
    <div aria-hidden="true" className="relative mx-auto w-32 h-24 [perspective:600px]">
      <div className="absolute inset-0 rounded-2xl bg-slate-900 border border-slate-700" />
      <div
        className={`absolute inset-x-4 top-3 h-16 rounded-lg bg-sky-400/15 border border-sky-400/40 p-2 space-y-1.5 transition-[transform,opacity] duration-700 ease-out motion-reduce:transition-none ${
          open ? '-translate-y-10 opacity-100' : 'translate-y-4 opacity-0'
        }`}
      >
        <span className="block h-1.5 w-3/4 rounded bg-sky-400/60" />
        <span className="block h-1 w-full rounded bg-sky-400/30" />
        <span className="block h-1 w-5/6 rounded bg-sky-400/30" />
      </div>
      <div className="absolute inset-0 rounded-2xl bg-slate-900 border border-slate-700 [clip-path:polygon(0_28%,50%_62%,100%_28%,100%_100%,0_100%)]" />
      <div
        className={`absolute inset-x-0 top-0 h-14 origin-top bg-slate-800 border border-slate-700 rounded-t-2xl [clip-path:polygon(0_0,100%_0,50%_100%)] transition-transform duration-500 motion-reduce:transition-none ${
          open ? '[transform:rotateX(180deg)] -z-10' : ''
        }`}
      />
    </div>
  )
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState(0)
  const t = useTranslations('auth.forgotPassword')
  const captcha = useRef<TurnstileHandle>(null)
  const steps = t.raw('steps') as string[]
  const stage = sent ? 1 : 0

  useEffect(() => {
    if (remaining <= 0) return
    const id = window.setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => window.clearTimeout(id)
  }, [remaining])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (remaining > 0) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), captchaToken: await captcha.current?.take() }),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok && res.status !== 200) {
      setError(data.error ?? t('fallbackError'))
    } else {
      setSent(true)
      setRemaining(RESEND_SECONDS)
    }

    setLoading(false)
  }

  return (
    <div className="eq-public relative min-h-screen bg-slate-950 overflow-hidden flex flex-col">
      {/* Ripples spreading from the envelope */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60 [background-image:repeating-radial-gradient(circle_at_50%_38%,transparent_0,transparent_46px,color-mix(in_oklch,var(--color-sky-400)_9%,transparent)_47px,transparent_48px)] [mask-image:radial-gradient(circle_at_50%_38%,black,transparent_62%)]"
      />
      <div aria-hidden="true" className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 w-[34rem] h-[34rem] rounded-full bg-sky-500/10 blur-3xl" />

      <AuthTopBar className="px-4 sm:px-8 lg:px-12 py-5" />

      <main className="relative flex-1 flex flex-col items-center justify-center px-4 pb-12">
        {/* Journey */}
        <ol aria-label={t('stepsLabel')} className="w-full max-w-2xl grid grid-cols-3 gap-2 sm:gap-3 mb-10">
          {steps.map((label, i) => (
            <li key={label} aria-current={i === stage ? 'step' : undefined} className="text-center">
              <span className={`block h-1.5 rounded-full transition-colors duration-500 ${i < stage ? 'bg-sky-400' : i === stage ? 'bg-sky-400 motion-safe:animate-pulse' : 'bg-slate-800'}`} />
              <span className={`block mt-3 text-xs sm:text-sm ${i <= stage ? 'text-white font-medium' : 'text-slate-500'}`}>{label}</span>
            </li>
          ))}
        </ol>

        <div className="w-full max-w-lg rounded-[2rem] border border-slate-800 bg-slate-900/70 backdrop-blur-xl shadow-2xl px-6 sm:px-10 pt-12 pb-9 text-center">
          <Envelope open={sent} />

          {sent ? (
            <div className="eq-menu-in mt-8" aria-live="polite">
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('sentTitle')}</h1>
              <p className="text-slate-300 mt-3 leading-relaxed">{t('sent')}</p>
              <p className="text-slate-500 text-sm mt-2 leading-relaxed">{t('spamHint')}</p>
              <p className="mt-5 inline-block px-4 py-2 rounded-full bg-sky-400/10 border border-sky-400/25 text-sky-300 text-xs">{t('linkNote')}</p>

              <div className="mt-8 flex flex-col items-center gap-3">
                {remaining > 0 ? (
                  <>
                    <div className="relative w-16 h-16">
                      <svg viewBox="0 0 60 60" className="w-16 h-16 -rotate-90" aria-hidden="true">
                        <circle cx="30" cy="30" r="26" fill="none" strokeWidth="4" className="stroke-slate-800" />
                        <circle
                          cx="30" cy="30" r="26" fill="none" strokeWidth="4" strokeLinecap="round"
                          className="stroke-sky-400 transition-[stroke-dashoffset] duration-1000 ease-linear"
                          strokeDasharray={RING}
                          strokeDashoffset={RING * (1 - remaining / RESEND_SECONDS)}
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-white font-semibold tabular-nums">{remaining}</span>
                    </div>
                    <p className="text-slate-500 text-xs">{t('retryHint')}</p>
                  </>
                ) : (
                  <button onClick={() => setSent(false)} className="px-5 py-2.5 rounded-xl border border-slate-700 text-sky-300 hover:border-sky-400/60 text-sm transition-colors">
                    {t('sendAnother')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
              <p className="text-slate-400 mt-3 leading-relaxed">{t('subtitle')}</p>
              <form onSubmit={handleSubmit} className="mt-8 space-y-4 text-start">
                {error && (
                  <div role="alert" className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-sm">{error}</div>
                )}
                <div>
                  <label htmlFor="forgot-email" className="block text-sm font-medium text-slate-300 mb-2">{t('email')}</label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    dir="ltr"
                    placeholder="you@school.edu"
                    className="w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition"
                  />
                </div>
                <Turnstile ref={captcha} />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 disabled:cursor-not-allowed text-on-accent font-semibold rounded-xl transition-colors shadow-lg shadow-sky-600/20"
                >
                  {loading ? t('submitLoading') : t('submit')}
                </button>
              </form>
            </div>
          )}
        </div>

        <Link href="/login" className="mt-8 text-slate-400 hover:text-white text-sm transition-colors">{t('backToSignIn')}</Link>
      </main>
    </div>
  )
}
