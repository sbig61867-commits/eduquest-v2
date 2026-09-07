'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [sent,      setSent]      = useState(false)
  const [error,     setError]     = useState('')
  const [disabled,  setDisabled]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok && res.status !== 200) {
      setError(data.error ?? 'Something went wrong. Please try again.')
    } else {
      setSent(true)
      // Disable resend for 60 s to prevent double-clicking/spam from the UI
      setDisabled(true)
      setTimeout(() => setDisabled(false), 60_000)
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      <div className="w-full max-w-md p-8 space-y-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent mb-2">
            <span className="text-fg text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-fg">Reset your password</h1>
          <p className="text-fg-secondary text-sm">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm text-center leading-relaxed">
              If that email is registered, you will receive a reset link shortly.
              <br />
              <span className="text-fg-secondary text-xs mt-1 block">Check your spam folder if it doesn&apos;t arrive within a few minutes.</span>
            </div>
            {disabled ? (
              <p className="text-fg-muted text-xs text-center">You can request another link in ~60 seconds.</p>
            ) : (
              <button
                onClick={() => setSent(false)}
                className="w-full text-center text-accent hover:text-accent text-sm transition-colors"
              >
                Send another link
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-fg-secondary mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@university.edu"
                className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-accent hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-fg font-medium rounded-lg transition-colors"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="flex justify-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-fg-secondary hover:text-fg text-sm transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
