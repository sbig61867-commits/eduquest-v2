'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { AuthTopBar } from '@/components/public/auth-top-bar'

// Setting a new password. Same public look (`.eq-public`, light/dark), built
// as one wide card split in two: the form, and a criteria panel that checks
// the password live with a strength meter. Accent: emerald.
//
// Only length and confirmation are REQUIRED (unchanged policy); the other
// criteria feed the strength meter as guidance.

const MIN_PW_LEN = 8
const INPUT =
  'w-full px-4 py-3 pe-20 rounded-xl bg-slate-950/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition'
const METER_TONE = ['bg-slate-800', 'bg-red-400', 'bg-amber-400', 'bg-sky-400', 'bg-emerald-400']

function Check({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative flex items-center justify-center w-5 h-5 rounded-full border shrink-0 transition-colors ${
        ok ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'
      }`}
    >
      {ok && <span className="block w-1.5 h-2.5 -mt-0.5 border-b-2 border-r-2 border-on-accent rotate-45" />}
    </span>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="eq-public relative min-h-screen bg-slate-950 overflow-hidden flex flex-col">
      <div aria-hidden="true" className="absolute -top-40 end-0 w-[40rem] h-[40rem] rounded-full bg-emerald-500/10 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-48 start-0 w-[36rem] h-[36rem] rounded-full bg-blue-600/10 blur-3xl" />
      <AuthTopBar className="px-4 sm:px-8 lg:px-12 py-5" />
      <main className="relative flex-1 flex items-center justify-center px-4 py-10">{children}</main>
    </div>
  )
}

function PasswordField({ id, label, value, onChange, showLabel, hideLabel, autoFocus }: {
  id: string; label: string; value: string; onChange: (v: string) => void
  showLabel: string; hideLabel: string; autoFocus?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
      <div className="relative" dir="ltr">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          required
          autoComplete="new-password"
          autoFocus={autoFocus}
          placeholder="••••••••"
          className={INPUT}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          aria-pressed={show}
          aria-controls={id}
          className="absolute inset-y-1.5 end-1.5 px-3 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          {show ? hideLabel : showLabel}
        </button>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const t = useTranslations('auth.resetPassword')

  const [sessionReady, setSessionReady] = useState<'loading' | 'ok' | 'expired'>('loading')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Verify there is an active recovery session before rendering the form.
  // The Supabase PKCE callback (/auth/callback) already exchanged the code
  // and set session cookies — getSession() reads those cookies here.
  // If there is no session (link expired / already used / direct navigation),
  // we show an error instead of the form.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionReady(session ? 'ok' : 'expired')
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < MIN_PW_LEN) {
      setError(t('lengthError', { min: MIN_PW_LEN }))
      return
    }
    if (password !== confirm) {
      setError(t('mismatchError'))
      return
    }

    setLoading(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
      return
    }

    // Deliberate security choice: end ALL of the user's sessions on every
    // device after a password change (they likely reset because the password
    // was forgotten or the account was suspected compromised). This also ends
    // the current recovery session so the proxy doesn't bounce /login back to
    // the dashboard. Note: signOut() with no scope already defaults to
    // 'global' — the explicit scope documents the intent.
    const { error: signOutErr } = await supabase.auth.signOut({ scope: 'global' })
    if (signOutErr) {
      // Password DID change; only the sign-out failed. Don't redirect into a
      // half-signed-in state — tell the user and let them sign in manually.
      console.error('post-reset signOut failed:', signOutErr.message)
      setError(t('signOutFailed'))
      setLoading(false)
      return
    }

    setDone(true)
    setLoading(false)
    // Redirect to login after a short delay so the user reads the success message
    setTimeout(() => router.push('/login?reset=success'), 2500)
  }

  // ── States ─────────────────────────────────────────────────────────────────

  if (sessionReady === 'loading') {
    return (
      <Shell>
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </Shell>
    )
  }

  if (sessionReady === 'expired') {
    return (
      <Shell>
        <div className="w-full max-w-md rounded-[2rem] border border-amber-400/25 bg-slate-900/80 backdrop-blur-xl p-9 text-center shadow-2xl">
          {/* A broken link, drawn in CSS */}
          <div aria-hidden="true" className="relative mx-auto w-28 h-14 mb-6">
            <span className="absolute start-0 top-2 w-14 h-9 rounded-full border-4 border-amber-400/80 -rotate-12" />
            <span className="absolute end-0 top-3 w-14 h-9 rounded-full border-4 border-slate-600 rotate-12" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('expiredTitle')}</h1>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed">{t('expiredBody')}</p>
          <a href="/forgot-password" className="inline-block mt-7 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-on-accent font-semibold rounded-xl transition-colors text-sm">
            {t('expiredCta')}
          </a>
        </div>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <div className="w-full max-w-md rounded-[2rem] border border-emerald-400/25 bg-slate-900/80 backdrop-blur-xl p-9 text-center shadow-2xl" aria-live="polite">
          <span aria-hidden="true" className="mx-auto mb-6 flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500">
            <span className="block w-4 h-7 -mt-1.5 border-b-4 border-r-4 border-on-accent rotate-45" />
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('successTitle')}</h1>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed">{t('successBody')}</p>
          <div className="mt-7 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-emerald-400 eq-grow" />
          </div>
          <p className="text-slate-500 text-xs mt-3">{t('redirecting')}</p>
        </div>
      </Shell>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  const rules = [
    { key: 'length', ok: password.length >= MIN_PW_LEN },
    { key: 'cases', ok: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { key: 'digit', ok: /\d/.test(password) },
    { key: 'symbol', ok: /[^A-Za-z0-9]/.test(password) },
    { key: 'match', ok: confirm.length > 0 && password === confirm },
  ] as const
  const score = password ? Math.max(1, rules.slice(0, 4).filter(r => r.ok).length) : 0
  const levels = t.raw('strength') as string[]

  return (
    <Shell>
      <div className="w-full max-w-5xl grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] rounded-[2rem] border border-slate-800 bg-slate-900/80 backdrop-blur-xl shadow-2xl overflow-hidden">
        {/* Form */}
        <div className="p-7 sm:p-10 lg:p-12">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
          <p className="text-slate-400 mt-3 leading-relaxed">{t('subtitle', { min: MIN_PW_LEN })}</p>

          {error && (
            <div role="alert" className="mt-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <PasswordField id="new-password" label={t('newPassword')} value={password} onChange={setPassword} showLabel={t('show')} hideLabel={t('hide')} autoFocus />
            <PasswordField id="confirm-password" label={t('confirmPassword')} value={confirm} onChange={setConfirm} showLabel={t('show')} hideLabel={t('hide')} />
            <button
              type="submit"
              disabled={loading || password.length < MIN_PW_LEN || password !== confirm}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-on-accent font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-600/20"
            >
              {loading ? t('submitLoading') : t('submit')}
            </button>
          </form>
        </div>

        {/* Criteria */}
        <aside className="relative p-7 sm:p-10 lg:p-12 border-t lg:border-t-0 lg:border-s border-slate-800 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-950">
          <p className="text-emerald-300 text-sm font-semibold">{t('strengthLabel')}</p>
          <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden="true">
            {[1, 2, 3, 4].map(i => (
              <span key={i} className={`h-2 rounded-full transition-colors duration-300 ${score >= i ? METER_TONE[score] : 'bg-slate-800'}`} />
            ))}
          </div>
          <p className="mt-2 text-white font-semibold" aria-live="polite">{levels[score]}</p>

          <p className="mt-8 text-slate-500 text-xs font-semibold">{t('checklistTitle')}</p>
          <ul className="mt-3 space-y-3">
            {rules.map(r => (
              <li key={r.key} className="flex items-center gap-3 text-sm">
                <Check ok={r.ok} />
                <span className={r.ok ? 'text-white' : 'text-slate-400'}>{t(`rules.${r.key}`, { min: MIN_PW_LEN })}</span>
              </li>
            ))}
          </ul>

          <div className="mt-10 rounded-2xl border border-slate-700/60 bg-slate-950/50 p-5">
            <p className="text-white font-semibold">{t('asideTitle')}</p>
            <p className="text-slate-400 text-sm mt-2 leading-relaxed">{t('asideBody')}</p>
          </div>
        </aside>
      </div>
    </Shell>
  )
}
