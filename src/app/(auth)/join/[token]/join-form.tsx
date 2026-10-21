'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { getRoleDashboardPath } from '@/lib/utils'
import { checkNameParts, EMPTY_NAME_PARTS, JOIN_NAME_COOKIE, type NameParts } from '@/lib/person-name'
import { FourPartNameFields } from '@/components/shared/four-part-name-fields'
import type { Role } from '@/types'
import { googleSignInEnabled } from '@/lib/google-sign-in'
import { Turnstile, type TurnstileHandle } from '@/components/shared/turnstile'

interface Props {
  token: string
  invitedEmail: string  // empty string for public invitations
  isPublic: boolean
  /** The invited role: a student registers with a four-part name. */
  role: string
  /** Set when a Google sign-up came back without a valid four-part name. */
  nameRequired?: boolean
}

export function JoinForm({ token, invitedEmail, isPublic, role, nameRequired = false }: Props) {
  const isStudent = role === 'student'
  const [email, setEmail]                   = useState(isPublic ? '' : invitedEmail)
  const [fullName, setFullName]             = useState('')
  const [nameParts, setNameParts]           = useState<NameParts>(EMPTY_NAME_PARTS)
  const [showNameErrors, setShowNameErrors] = useState(nameRequired)
  const [password, setPassword]             = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const t = useTranslations('auth.join')
  const tName = useTranslations('common.studentName')
  const [error, setError]                   = useState(nameRequired ? t('googleNameRequired') : '')
  const [debugInfo, setDebugInfo]           = useState<string | null>(null)
  const [loading, setLoading]               = useState(false)
  const [googleLoading, setGoogleLoading]   = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const captcha = useRef<TurnstileHandle>(null)
  const isDev = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEV_MODE === 'true'

  /** A student's four parts must be valid before either way of signing up. */
  function studentNameReady(): boolean {
    if (!isStudent || checkNameParts(nameParts).ok) return true
    setShowNameErrors(true)
    setError(tName('incomplete'))
    return false
  }

  async function handleGoogleSignIn() {
    setError('')
    if (!studentNameReady()) return
    if (isStudent) {
      // Google supplies its own (often two-part) name; the four parts ride
      // along to /auth/callback, which validates them again before provisioning.
      const secure = window.location.protocol === 'https:' ? '; secure' : ''
      document.cookie = `${JOIN_NAME_COOKIE}=${encodeURIComponent(JSON.stringify(nameParts))}; path=/auth/callback; max-age=600; samesite=lax${secure}`
    }
    setGoogleLoading(true)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?invite=${encodeURIComponent(token)}`,
      },
    })
    if (oauthError) {
      setError(oauthError.message)
      setGoogleLoading(false)
    }
    // On success the browser is redirected to Google — no further action here.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!studentNameReady()) return
    if (password !== confirmPassword) {
      setError(t('passwordMismatch'))
      return
    }
    if (password.length < 8) {
      setError(t('passwordTooShort'))
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isStudent
          ? { token, email: email.trim(), password, nameParts, captchaToken: await captcha.current?.take() }
          : { token, email: email.trim(), password, fullName, captchaToken: await captcha.current?.take() }),
      })

      let data: Record<string, unknown> = {}
      try { data = await res.json() } catch { /* empty response */ }

      if (!res.ok) {
        const msg = typeof data.error === 'string' ? data.error : 'Registration failed. Please try again.'
        setError(msg)
        setDebugInfo(JSON.stringify({ status: res.status, ...data }, null, 2))
        setLoading(false)
        return
      }

      const registeredEmail = typeof data.email === 'string' ? data.email : email.trim()

      const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
        email: registeredEmail,
        password,
      })

      if (signInError || !session.user) {
        router.push(`/login?email=${encodeURIComponent(registeredEmail)}&registered=true`)
        return
      }

      const { data: profile } = await supabase
        .from('users').select('role').eq('id', session.user.id).single()

      const role: Role = (profile?.role as Role) ?? 'student'
      // ?welcome=1: the header greets the new account with its details and ID.
      router.push(`${getRoleDashboardPath(role)}?welcome=1`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(t('networkError'))
      setDebugInfo(JSON.stringify({ network_error: msg }, null, 2))
      console.error('[join-form]', err)
      setLoading(false)
    }
  }

  const ring = isPublic ? 'focus:ring-violet-400' : 'focus:ring-blue-500'
  const input = `w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${ring} focus:border-transparent transition`

  return (
    <div className="rounded-[1.75rem] border border-slate-800 bg-slate-900/70 backdrop-blur-xl p-7 sm:p-10 shadow-2xl">
      <h2 className="text-2xl font-bold text-white">{t('formTitle')}</h2>
      <p className="text-slate-400 text-sm mt-2">{t('formSubtitle')}</p>

      {error && (
        <div className="mt-6 space-y-2">
          <div role="alert" className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-sm">
            {error}
          </div>
          {isDev && debugInfo && (
            <details className="rounded-lg bg-slate-800 border border-slate-700 text-xs">
              <summary className="px-3 py-2 text-amber-300 cursor-pointer select-none font-mono">
                🛠 Dev — {t('devDetails')}
              </summary>
              <pre className="px-3 pb-3 text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                {debugInfo}
              </pre>
            </details>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-7 grid sm:grid-cols-2 gap-5">
        {/* Email — editable for public links, read-only for private */}
        <div className="sm:col-span-2">
          <label htmlFor="join-email" className="block text-sm font-medium text-slate-300 mb-2">{t('email')}</label>
          {isPublic ? (
            <input
              id="join-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              dir="ltr"
              autoComplete="email"
              placeholder="your@email.com"
              className={input}
            />
          ) : (
            <>
              <input
                id="join-email"
                type="email"
                value={invitedEmail}
                readOnly
                dir="ltr"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-800 text-slate-400 cursor-not-allowed select-none"
              />
              <p className="text-xs text-slate-500 mt-1.5">{t('lockedEmail')}</p>
            </>
          )}
        </div>

        <div className="sm:col-span-2">
          {isStudent ? (
            <FourPartNameFields
              idPrefix="join-name"
              value={nameParts}
              onChange={setNameParts}
              showErrors={showNameErrors}
              hint={tName('hintSelf')}
              inputClassName={input}
            />
          ) : (
            <>
              <label htmlFor="join-name" className="block text-sm font-medium text-slate-300 mb-2">{t('fullName')}</label>
              <input
                id="join-name"
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
                minLength={2}
                autoComplete="name"
                placeholder={t('fullNamePlaceholder')}
                className={input}
              />
            </>
          )}
        </div>

        <div>
          <label htmlFor="join-password" className="block text-sm font-medium text-slate-300 mb-2">{t('password')}</label>
          <input
            id="join-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t('passwordPlaceholder')}
            className={input}
          />
        </div>

        <div>
          <label htmlFor="join-confirm" className="block text-sm font-medium text-slate-300 mb-2">{t('confirmPassword')}</label>
          <input
            id="join-confirm"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder={t('confirmPlaceholder')}
            className={input}
          />
          {confirmPassword.length > 0 && (
            <p className={`text-xs mt-1.5 ${password === confirmPassword ? 'text-emerald-300' : 'text-red-300'}`}>
              {password === confirmPassword ? t('match') : t('noMatch')}
            </p>
          )}
        </div>

        <Turnstile ref={captcha} className="sm:col-span-2" />

        <button
          type="submit"
          disabled={loading}
          className={`sm:col-span-2 w-full py-3 px-4 disabled:opacity-60 disabled:cursor-not-allowed text-on-accent font-semibold rounded-xl transition-colors shadow-lg ${
            isPublic
              ? 'bg-violet-600 hover:bg-violet-500 shadow-violet-600/20'
              : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20'
          }`}
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
      {isStudent && <p className="text-xs text-slate-500 text-center mt-2">{t('googleNameHint')}</p>}
      </>)}
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
