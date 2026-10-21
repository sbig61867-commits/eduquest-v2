'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { AuthTopBar } from '@/components/public/auth-top-bar'
import { Turnstile, type TurnstileHandle } from '@/components/shared/turnstile'
import { getRoleDashboardPath } from '@/lib/utils'
import type { Role } from '@/types'

// First sign-in with a temporary password set by staff: the proxy sends the
// user here until they choose their own (/api/auth/change-password clears
// app_metadata.must_change_password). Also shows the member ID they will
// sign in with from now on.

const MIN_PW_LEN = 8
const INPUT =
  'w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition'

export default function ChangePasswordPage() {
  const supabase = createClient()
  const t = useTranslations('auth.changePassword')
  const captcha = useRef<TurnstileHandle>(null)
  const [memberCode, setMemberCode] = useState<string | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return }
      const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()
      setMemberCode((data?.member_code as string | undefined) ?? null)
      setRole((data?.role as Role | undefined) ?? null)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < MIN_PW_LEN) { setError(t('lengthError', { min: MIN_PW_LEN })); return }
    if (password !== confirm) { setError(t('mismatchError')); return }
    setLoading(true)
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, captchaToken: await captcha.current?.take() }),
    })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? t('failed'))
      setLoading(false)
      return
    }
    // Re-mint the JWT so it no longer carries must_change_password.
    await supabase.auth.refreshSession()
    window.location.href = role ? `${getRoleDashboardPath(role)}?welcome=1` : '/login'
  }

  return (
    <div className="eq-public relative min-h-screen bg-slate-950 overflow-hidden flex flex-col">
      <AuthTopBar className="px-4 sm:px-8 lg:px-12 py-5" />
      <main className="relative flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/80 backdrop-blur-xl shadow-2xl p-7 sm:p-10">
          <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          <p className="text-slate-400 mt-3 leading-relaxed text-sm">{t('subtitle', { min: MIN_PW_LEN })}</p>

          {memberCode && (
            <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-emerald-300 text-xs font-semibold">{t('yourId')}</p>
              <p className="text-white text-xl font-mono font-bold mt-1" dir="ltr">{memberCode}</p>
              <p className="text-slate-400 text-xs mt-2">{t('idHint')}</p>
            </div>
          )}

          {error && <div role="alert" className="mt-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-slate-300 mb-2">{t('newPassword')}</label>
              <input id="new-password" type="password" dir="ltr" autoComplete="new-password" required autoFocus
                value={password} onChange={e => setPassword(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-300 mb-2">{t('confirmPassword')}</label>
              <input id="confirm-password" type="password" dir="ltr" autoComplete="new-password" required
                value={confirm} onChange={e => setConfirm(e.target.value)} className={INPUT} />
            </div>
            <Turnstile ref={captcha} />
            <button type="submit" disabled={loading}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-on-accent font-semibold rounded-xl transition-colors">
              {loading ? t('submitLoading') : t('submit')}
            </button>
          </form>
          <form action="/auth/signout" method="post" className="text-center mt-5">
            <button type="submit" className="text-slate-500 hover:text-slate-300 text-xs">{t('signOut')}</button>
          </form>
        </div>
      </main>
    </div>
  )
}
