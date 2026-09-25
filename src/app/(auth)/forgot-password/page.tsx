'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [sent,      setSent]      = useState(false)
  const [error,     setError]     = useState('')
  const [disabled,  setDisabled]  = useState(false)
  const t = useTranslations('auth.forgotPassword')

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
      setError(data.error ?? t('fallbackError'))
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
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-2">
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm">
            {t('subtitle')}
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm text-center leading-relaxed">
              {t('sent')}
              <br />
              <span className="text-slate-400 text-xs mt-1 block">{t('spamHint')}</span>
            </div>
            {disabled ? (
              <p className="text-slate-500 text-xs text-center">{t('retryHint')}</p>
            ) : (
              <button
                onClick={() => setSent(false)}
                className="w-full text-center text-blue-400 hover:text-blue-300 text-sm transition-colors"
              >
                {t('sendAnother')}
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
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                {t('email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@school.edu"
                className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {loading ? t('submitLoading') : t('submit')}
            </button>
          </form>
        )}

        <div className="flex justify-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> {t('backToSignIn')}
          </Link>
        </div>
      </div>
    </div>
  )
}
