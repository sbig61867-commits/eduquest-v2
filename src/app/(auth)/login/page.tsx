'use client'

import { Suspense } from 'react'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getRoleDashboardPath } from '@/lib/utils'
import type { Role } from '@/types'
import { HelperMascot } from '@/components/public/helper-mascot'

function LoginForm() {
  const searchParams = useSearchParams()
  const prefillEmail = searchParams.get('email') ?? ''
  const registered = searchParams.get('registered') === 'true'

  const [email, setEmail] = useState(prefillEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const errorMsg = searchParams.get('error')

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

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', data.user.id)
        .single()

      if (profile) {
        router.push(getRoleDashboardPath(profile.role as Role))
      }
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
          <h1 className="text-2xl font-bold text-fg">EduQuest</h1>
          <p className="text-fg-secondary text-sm">Sign in to your account</p>
        </div>

        {registered && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
            Account created successfully! Please sign in.
          </div>
        )}

        {searchParams.get('reset') === 'success' && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            Password updated successfully. Please sign in with your new password.
          </div>
        )}

        {(error || errorMsg) && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error || (
              errorMsg === 'account_disabled'      ? 'Your account has been disabled. Contact your administrator.' :
              errorMsg === 'university_removed'    ? 'Your university has been removed from the platform. Contact support.' :
              errorMsg === 'invitation_required'   ? 'التسجيل في المنصة يتطلب رابط دعوة من مؤسستك. يرجى التواصل مع الجهة الإدارية للحصول على رابط دعوة، أو تسجيل الدخول إذا كان لديك حساب بالفعل.' :
              errorMsg === 'auth_callback_failed'  ? 'تعذّر إتمام تسجيل الدخول. يرجى المحاولة مرة أخرى.' :
              'You are not authorized to access this page.'
            )}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg-secondary mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
              placeholder="you@university.edu"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg-secondary mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-fg placeholder-fg-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
              placeholder="••••••••"
            />
          </div>
          <div className="flex justify-end">
            <a
              href="/forgot-password"
              className="text-accent hover:text-accent text-xs transition-colors"
            >
              Forgot password?
            </a>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-accent hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-fg font-medium rounded-lg transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-fg-muted">أو</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed text-slate-800 font-medium rounded-lg transition-colors"
        >
          <GoogleIcon />
          {googleLoading ? 'جارٍ التحويل إلى Google...' : 'تسجيل الدخول باستخدام Google'}
        </button>
      </div>
      <HelperMascot lang="ar" />
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
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
