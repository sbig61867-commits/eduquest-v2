'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff } from 'lucide-react'
import { RevealOnScroll } from '@/components/shared/motion'

const MIN_PW_LEN = 8

export default function ResetPasswordPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [sessionReady, setSessionReady] = useState<'loading' | 'ok' | 'expired'>('loading')
  const [password,     setPassword]     = useState('')
  const [confirm,      setConfirm]      = useState('')
  const [showPw,       setShowPw]       = useState(false)
  const [showCf,       setShowCf]       = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [done,         setDone]         = useState(false)

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
      setError(`Password must be at least ${MIN_PW_LEN} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
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
      setError('Your password was changed, but signing out failed. Please close this tab and sign in again with your new password.')
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
      <div className="min-h-screen flex items-center justify-center bg-canvas bg-[radial-gradient(ellipse_at_top,var(--color-accent-subtle),var(--color-canvas)_60%)] p-4">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (sessionReady === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas bg-[radial-gradient(ellipse_at_top,var(--color-accent-subtle),var(--color-canvas)_60%)] p-4">
        <div className="w-full max-w-md p-8 space-y-5 bg-elevated border border-border rounded-2xl shadow-xl text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-error-subtle border border-error/25 mb-2">
            <span className="text-error text-3xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-fg">Link expired or invalid</h1>
          <p className="text-fg-secondary text-sm leading-relaxed">
            This password reset link has already been used or has expired.
            Reset links are valid for one hour and can only be used once.
          </p>
          <a
            href="/forgot-password"
            className="inline-block px-6 py-2.5 bg-accent hover:bg-accent-hover text-accent-fg font-medium rounded-lg transition-colors text-sm"
          >
            Request a new link
          </a>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas bg-[radial-gradient(ellipse_at_top,var(--color-accent-subtle),var(--color-canvas)_60%)] p-4">
        <div className="w-full max-w-md p-8 space-y-4 bg-elevated border border-border rounded-2xl shadow-xl text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-success-subtle border border-success/25 mb-2">
            <span className="text-success text-3xl">✓</span>
          </div>
          <h1 className="text-xl font-bold text-fg">Password updated</h1>
          <p className="text-fg-secondary text-sm">
            Your password has been changed and you were signed out of all
            devices. Please sign in again with your new password. Redirecting…
          </p>
        </div>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas bg-[radial-gradient(ellipse_at_top,var(--color-accent-subtle),var(--color-canvas)_60%)] p-4">
      <RevealOnScroll className="w-full max-w-md p-8 space-y-6 bg-elevated border border-border rounded-2xl shadow-xl" mode="mount">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent mb-2">
            <span className="text-accent-fg text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-fg">Set new password</h1>
          <p className="text-fg-secondary text-sm">
            Choose a strong password — at least {MIN_PW_LEN} characters.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-subtle border border-error/25 text-error text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* New password */}
          <div>
            <label className="block text-sm font-medium text-fg-secondary mb-1.5">
              New password
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={MIN_PW_LEN}
                autoComplete="new-password"
                placeholder="••••••••"
                className="w-full px-4 py-2.5 pe-10 rounded-lg bg-canvas border border-border text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute inset-y-0 end-3 flex items-center text-fg-secondary hover:text-fg transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {/* Strength hint */}
            {password.length > 0 && password.length < MIN_PW_LEN && (
              <p className="text-xs text-warning mt-1">
                {MIN_PW_LEN - password.length} more character{MIN_PW_LEN - password.length !== 1 ? 's' : ''} needed
              </p>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium text-fg-secondary mb-1.5">
              Confirm new password
            </label>
            <div className="relative">
              <input
                type={showCf ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="••••••••"
                className="w-full px-4 py-2.5 pe-10 rounded-lg bg-canvas border border-border text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowCf(v => !v)}
                className="absolute inset-y-0 end-3 flex items-center text-fg-secondary hover:text-fg transition-colors"
                tabIndex={-1}
              >
                {showCf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {/* Live match indicator */}
            {confirm.length > 0 && (
              <p className={`text-xs mt-1 ${password === confirm ? 'text-success' : 'text-error'}`}>
                {password === confirm ? 'Passwords match ✓' : 'Passwords do not match'}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || password.length < MIN_PW_LEN || password !== confirm}
            className="w-full py-2.5 px-4 bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-accent-fg font-medium rounded-lg transition-colors"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </RevealOnScroll>
    </div>
  )
}
