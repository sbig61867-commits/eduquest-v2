'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getRoleDashboardPath } from '@/lib/utils'
import type { Role } from '@/types'

interface Props {
  token: string
  invitedEmail: string  // empty string for public invitations
  isPublic: boolean
}

export function JoinForm({ token, invitedEmail, isPublic }: Props) {
  const [email, setEmail]                   = useState(isPublic ? '' : invitedEmail)
  const [fullName, setFullName]             = useState('')
  const [password, setPassword]             = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError]                   = useState('')
  const [debugInfo, setDebugInfo]           = useState<string | null>(null)
  const [loading, setLoading]               = useState(false)
  const [googleLoading, setGoogleLoading]   = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const isDev = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEV_MODE === 'true'

  async function handleGoogleSignIn() {
    setError('')
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

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: email.trim(), password, fullName }),
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
      router.push(getRoleDashboardPath(role))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError('A network error occurred. Please try again.')
      setDebugInfo(JSON.stringify({ network_error: msg }, null, 2))
      console.error('[join-form]', err)
      setLoading(false)
    }
  }

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
      <h2 className="text-lg font-semibold text-fg mb-5">Create your account</h2>

      {error && (
        <div className="mb-4 space-y-2">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
          {isDev && debugInfo && (
            <details className="rounded-lg bg-elevated border border-border-strong text-xs">
              <summary className="px-3 py-2 text-amber-400 cursor-pointer select-none font-mono">
                🛠 Dev — تفاصيل الخطأ
              </summary>
              <pre className="px-3 pb-3 text-fg-secondary overflow-x-auto whitespace-pre-wrap break-all">
                {debugInfo}
              </pre>
            </details>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email — editable for public links, read-only for private */}
        <div>
          <label className="block text-sm font-medium text-fg-secondary mb-1.5">Email</label>
          {isPublic ? (
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
            />
          ) : (
            <>
              <input
                type="email"
                value={invitedEmail}
                readOnly
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-fg-secondary cursor-not-allowed select-none"
              />
              <p className="text-xs text-fg-muted mt-1">
                This invitation is locked to this email address.
              </p>
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-fg-secondary mb-1.5">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            minLength={2}
            placeholder="Your full name"
            className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-fg-secondary mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder="Min. 8 characters"
            className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-fg-secondary mb-1.5">Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            placeholder="Repeat your password"
            className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent transition"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-2.5 px-4 disabled:opacity-60 disabled:cursor-not-allowed text-fg font-medium rounded-lg transition-colors mt-2 ${
            isPublic
              ? 'bg-purple-600 hover:bg-purple-500'
              : 'bg-accent hover:bg-blue-500'
          }`}
        >
          {loading ? 'Creating account…' : 'Join EduQuest'}
        </button>
      </form>

      <div className="flex items-center gap-3 mt-5">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-xs text-fg-muted">أو</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={googleLoading}
        className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 px-4 bg-white hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed text-slate-800 font-medium rounded-lg transition-colors"
      >
        <GoogleIcon />
        {googleLoading ? 'جارٍ التحويل إلى Google...' : 'المتابعة باستخدام Google'}
      </button>
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
