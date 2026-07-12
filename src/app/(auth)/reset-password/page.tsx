'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff } from 'lucide-react'

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

    // Sign out the current session so the proxy doesn't intercept the redirect
    // to /login and bounce the user back to the dashboard.
    // Other sessions will be invalidated by Supabase automatically on their
    // next token refresh (password change rotates the refresh token secret).
    await supabase.auth.signOut()

    setDone(true)
    setLoading(false)
    // Redirect to login after a short delay so the user reads the success message
    setTimeout(() => router.push('/login?reset=success'), 2500)
  }

  // ── States ─────────────────────────────────────────────────────────────────

  if (sessionReady === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (sessionReady === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="w-full max-w-md p-8 space-y-5 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-600/20 mb-2">
            <span className="text-red-400 text-3xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-white">Link expired or invalid</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            This password reset link has already been used or has expired.
            Reset links are valid for one hour and can only be used once.
          </p>
          <a
            href="/forgot-password"
            className="inline-block px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors text-sm"
          >
            Request a new link
          </a>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="w-full max-w-md p-8 space-y-4 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-600/20 mb-2">
            <span className="text-emerald-400 text-3xl">✓</span>
          </div>
          <h1 className="text-xl font-bold text-white">Password updated</h1>
          <p className="text-slate-400 text-sm">
            Your password has been changed. Redirecting you to sign in…
          </p>
        </div>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      <div className="w-full max-w-md p-8 space-y-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-2">
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Set new password</h1>
          <p className="text-slate-400 text-sm">
            Choose a strong password — at least {MIN_PW_LEN} characters.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* New password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
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
                className="w-full px-4 py-2.5 pr-10 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute inset-y-0 end-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {/* Strength hint */}
            {password.length > 0 && password.length < MIN_PW_LEN && (
              <p className="text-xs text-amber-400 mt-1">
                {MIN_PW_LEN - password.length} more character{MIN_PW_LEN - password.length !== 1 ? 's' : ''} needed
              </p>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
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
                className="w-full px-4 py-2.5 pr-10 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowCf(v => !v)}
                className="absolute inset-y-0 end-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
                tabIndex={-1}
              >
                {showCf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {/* Live match indicator */}
            {confirm.length > 0 && (
              <p className={`text-xs mt-1 ${password === confirm ? 'text-emerald-400' : 'text-red-400'}`}>
                {password === confirm ? 'Passwords match ✓' : 'Passwords do not match'}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || password.length < MIN_PW_LEN || password !== confirm}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
