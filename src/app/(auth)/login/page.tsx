'use client'

import { Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { getRoleDashboardPath } from '@/lib/utils'
import type { Role } from '@/types'
import type enAuth from '@/messages/en/auth.json'
import { AuthTopBar } from '@/components/public/auth-top-bar'
import { googleSignInEnabled } from '@/lib/google-sign-in'
import { isMemberCode, normalizeMemberCode } from '@/lib/member-code'

// Sign-in shares the public surface's look (`.eq-public`, light and dark —
// src/app/globals.css): a form on one side and, on large screens, a showcase
// panel with a rotating spotlight on the other.

const KNOWN_ERRORS = ['account_disabled', 'university_removed', 'invitation_required', 'auth_callback_failed', 'institution_full']
type Showcase = typeof enAuth.login.showcase
/** How long each spotlight slide stays up. */
const SLIDE_MS = 6500

// The visitor's local hour, read only on the client (the server cannot know
// the time zone) so the greeting never causes a hydration mismatch.
const noSubscribe = () => () => {}
function useLocalHour(): number | null {
  return useSyncExternalStore(noSubscribe, () => new Date().getHours(), () => null)
}

const INPUT =
  'w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'

function ShowcasePanel({ copy }: { copy: Showcase }) {
  const [slide, setSlide] = useState(0)
  const [paused, setPaused] = useState(false)
  const n = copy.slides.length

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setSlide(s => (s + 1) % n), SLIDE_MS)
    return () => window.clearInterval(id)
  }, [paused, n])

  const cards = [
    { label: copy.cards.lesson, tone: 'bg-blue-500', offset: 'lg:-translate-x-6', delay: '0s' },
    { label: copy.cards.exam, tone: 'bg-amber-400', offset: 'lg:translate-x-10', delay: '-2.3s' },
    { label: copy.cards.attendance, tone: 'bg-emerald-400', offset: 'lg:-translate-x-2', delay: '-4.6s' },
  ]

  return (
    <aside
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="relative hidden lg:flex flex-col overflow-hidden rounded-[2rem] border border-slate-800 bg-gradient-to-br from-blue-600/25 via-slate-900 to-slate-950 p-10 xl:p-14"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,var(--color-white)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-white)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
      />
      <div aria-hidden="true" className="absolute -top-32 -end-24 w-[28rem] h-[28rem] rounded-full bg-blue-500/25 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-40 -start-24 w-[26rem] h-[26rem] rounded-full bg-sky-400/10 blur-3xl" />

      <div className="relative">
        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/25 text-blue-300 text-sm font-medium">
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-blue-400 motion-safe:animate-pulse" />
          {copy.badge}
        </span>
        <p className="mt-6 text-3xl xl:text-4xl font-bold text-white leading-snug max-w-xl">{copy.title}</p>
      </div>

      {/* Floating cards: a glimpse of the platform at work. */}
      <div aria-hidden="true" className="relative flex-1 flex flex-col justify-center gap-4 py-10 max-w-md mx-auto w-full">
        {cards.map(c => (
          <div key={c.label} className={c.offset}>
            <div className="eq-float flex items-center gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/80 backdrop-blur px-5 py-4 shadow-2xl shadow-black/20" style={{ animationDelay: c.delay }}>
              <span className={`w-10 h-10 rounded-xl ${c.tone} opacity-90 shrink-0`} />
              <span className="flex-1 min-w-0">
                <span className="block text-white text-sm font-semibold truncate">{c.label}</span>
                <span className="mt-2 block h-1.5 w-3/4 rounded bg-slate-700" />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Spotlight carousel */}
      <section aria-label={copy.slidesLabel} className="relative rounded-2xl border border-slate-700/60 bg-slate-950/60 backdrop-blur p-6">
        <div key={slide} className="eq-menu-in min-h-[7.5rem]" aria-live="polite">
          <p className="text-blue-300 text-xs font-semibold">{copy.slides[slide].tag}</p>
          <p className="text-white text-lg font-semibold mt-2">{copy.slides[slide].title}</p>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">{copy.slides[slide].desc}</p>
        </div>
        <div className="mt-5 flex gap-2">
          {copy.slides.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-label={s.title}
              aria-pressed={i === slide}
              onClick={() => setSlide(i)}
              className="group h-6 flex-1 flex items-center"
            >
              <span className="block h-1 w-full rounded-full bg-slate-800 overflow-hidden">
                <span className={`block h-full rounded-full transition-[width] duration-500 ${i === slide ? 'w-full bg-blue-500' : i < slide ? 'w-full bg-blue-500/40' : 'w-0'}`} />
              </span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}

function LoginForm() {
  const t = useTranslations('auth.login')
  const searchParams = useSearchParams()
  const prefillEmail = searchParams.get('email') ?? ''
  const registered = searchParams.get('registered') === 'true'

  const [email, setEmail] = useState(prefillEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const hour = useLocalHour()

  const errorMsg = searchParams.get('error')
  const greeting =
    hour === null ? null : hour < 12 ? t('greeting.morning') : hour < 17 ? t('greeting.afternoon') : t('greeting.evening')

  async function handleGoogleSignIn() {
    setError('')
    setGoogleLoading(true)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (oauthError) {
      setError(oauthError.message)
      setGoogleLoading(false)
    }
    // On success the browser is redirected to Google — no further action here.
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // A member ID (QOU-S48203917) is resolved and signed in on the server;
    // anything else is an email, signed in directly.
    if (isMemberCode(email)) {
      const res = await fetch('/api/auth/login-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizeMemberCode(email), password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? t('errors.default')); setLoading(false); return }
      // A full load, so the browser client picks up the cookies the server set.
      window.location.replace(body.mustChangePassword ? '/change-password' : body.role ? getRoleDashboardPath(body.role as Role) : '/login')
      return
    }

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    if (data.user) {
      // The role is already in the new session's JWT (app_metadata.user_role,
      // kept in sync by the sync_user_claims trigger) — no extra query needed.
      // The DB is only asked for accounts whose claims were never backfilled.
      let role = data.user.app_metadata?.user_role as Role | undefined
      if (!role) {
        const { data: profile } = await supabase
          .from('users').select('role').eq('id', data.user.id).single()
        role = profile?.role as Role | undefined
      }
      if (data.user.app_metadata?.must_change_password === true) {
        router.replace('/change-password')
        return
      }
      if (role) {
        // Leave the button in its loading state until the dashboard replaces
        // this page: re-enabling it here made the wait look like a freeze.
        // replace, not push — Back should not return to the login form.
        router.replace(getRoleDashboardPath(role))
        return
      }
      setError(t('errors.default'))
    }

    setLoading(false)
  }

  const showcase = t.raw('showcase') as Showcase

  return (
    <div className="eq-public min-h-screen bg-slate-950 p-3 sm:p-4 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
      <main className="relative flex flex-col px-3 sm:px-8 lg:px-12 xl:px-16 py-4">
        <div aria-hidden="true" className="lg:hidden absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.2),transparent_70%)]" />

        <AuthTopBar />

        {/* Form */}
        <div className="relative flex-1 flex items-center py-10">
          <div className="w-full max-w-md mx-auto">
            <p className="text-blue-400 text-sm font-semibold h-5">{greeting}</p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-white">{t('welcome')}</h1>
            <p className="text-slate-400 mt-3 leading-relaxed">{t('subtitle')}</p>

            <div className="mt-8 space-y-3">
              {registered && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-sm">{t('registered')}</div>
              )}
              {searchParams.get('reset') === 'success' && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-sm">{t('resetSuccess')}</div>
              )}
              {(error || errorMsg) && (
                <div role="alert" className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-sm leading-relaxed">
                  {error || t(`errors.${KNOWN_ERRORS.includes(errorMsg ?? '') ? errorMsg : 'default'}`)}
                </div>
              )}
            </div>

            <form onSubmit={handleLogin} className="mt-4 space-y-5">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-slate-300 mb-2">{t('emailOrId')}</label>
                <input
                  id="login-email"
                  type="text"
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete="username"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  dir="ltr"
                  className={INPUT}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="login-password" className="block text-sm font-medium text-slate-300">{t('password')}</label>
                  <a href="/forgot-password" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">{t('forgot')}</a>
                </div>
                {/* LTR box so the toggle sits at the far end of the typed text in both languages. */}
                <div className="relative" dir="ltr">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyUp={e => setCapsLock(e.getModifierState('CapsLock'))}
                    onKeyDown={e => setCapsLock(e.getModifierState('CapsLock'))}
                    onBlur={() => setCapsLock(false)}
                    required
                    className={`${INPUT} pe-20`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-pressed={showPassword}
                    aria-controls="login-password"
                    className="absolute inset-y-1.5 end-1.5 px-3 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    {showPassword ? t('hidePassword') : t('showPassword')}
                  </button>
                </div>
                {capsLock && <p className="mt-2 text-amber-300 text-xs">{t('capsLock')}</p>}
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-on-accent font-semibold rounded-xl transition-colors shadow-lg shadow-blue-600/25"
              >
                {loading ? t('submitLoading') : t('submit')}
              </button>
            </form>

            {googleSignInEnabled() && (<>
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-xs text-slate-500">{t('or')}</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-2.5 py-3 px-4 bg-slate-900 border border-slate-700 hover:border-slate-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
            >
              <GoogleIcon />
              {googleLoading ? t('googleLoading') : t('google')}
            </button>
            </>)}

            <p className="mt-8 text-slate-500 text-sm leading-relaxed border-s-2 border-slate-700 ps-3">{t('invitationNote')}</p>
          </div>
        </div>

        <div className="relative">
          <Link href="/" className="text-slate-400 hover:text-white text-sm transition-colors">{t('backHome')}</Link>
        </div>
      </main>

      <ShowcasePanel copy={showcase} />
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4c-7.682 0-14.344 4.337-17.694 10.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="eq-public min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
