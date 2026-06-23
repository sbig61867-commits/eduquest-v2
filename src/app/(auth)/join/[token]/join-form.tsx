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
  const [loading, setLoading]               = useState(false)
  const router = useRouter()
  const supabase = createClient()

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

    const res = await fetch('/api/auth/accept-invitation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email: email.trim(), password, fullName }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Registration failed. Please try again.')
      setLoading(false)
      return
    }

    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password,
    })

    if (signInError || !session.user) {
      router.push(`/login?email=${encodeURIComponent(data.email)}&registered=true`)
      return
    }

    const { data: profile } = await supabase
      .from('users').select('role').eq('id', session.user.id).single()

    router.push(getRoleDashboardPath((profile?.role ?? 'student') as Role))
  }

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
      <h2 className="text-lg font-semibold text-white mb-5">Create your account</h2>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email — editable for public links, read-only for private */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
          {isPublic ? (
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
            />
          ) : (
            <>
              <input
                type="email"
                value={invitedEmail}
                readOnly
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 cursor-not-allowed select-none"
              />
              <p className="text-xs text-slate-500 mt-1">
                This invitation is locked to this email address.
              </p>
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            minLength={2}
            placeholder="Your full name"
            className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder="Min. 8 characters"
            className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            placeholder="Repeat your password"
            className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-2.5 px-4 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors mt-2 ${
            isPublic
              ? 'bg-purple-600 hover:bg-purple-500'
              : 'bg-blue-600 hover:bg-blue-500'
          }`}
        >
          {loading ? 'Creating account…' : 'Join EduQuest'}
        </button>
      </form>
    </div>
  )
}
