'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

// One browser holds one sign-in (a cookie shared by every tab of the site).
// Signing in to another account in a second tab silently moves the first tab
// to that account too, and its next request lands on the wrong role and is
// sent to sign-in (owner report, 2026-10-18). This notice says so plainly the
// moment the older tab comes back into view, instead of a surprise redirect.
// It reads the session locally (no network) on focus and visibility changes.

export function AccountSwitchNotice() {
  const t = useTranslations('common.account.switched')
  const [state, setState] = useState<'same' | 'other' | 'none'>('same')
  const first = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const supabase = createClient()
    let alive = true
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!alive) return
      const id = session?.user.id ?? null
      if (first.current === undefined) { first.current = id; return }
      if (first.current && id !== first.current) setState(id ? 'other' : 'none')
    }
    void check()
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  if (state === 'same') return null
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="eq-switch-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/90 p-4">
      <div className="w-full max-w-md rounded-overlay border border-line bg-surface p-6 shadow-overlay">
        <h2 id="eq-switch-title" className="text-h3 text-fg">{state === 'other' ? t('title') : t('signedOutTitle')}</h2>
        <p className="mt-2 text-body-sm text-fg-2">{state === 'other' ? t('body') : t('signedOutBody')}</p>
        <p className="mt-2 text-body-sm text-fg-2">{t('tip')}</p>
        <div className="mt-4 flex justify-end">
          {/* "/" sends a signed-in user to their own dashboard, a signed-out one to sign-in (proxy.ts). */}
          <button type="button" onClick={() => { window.location.href = state === 'other' ? '/' : '/login' }}
            className="eq-focus rounded-control bg-accent px-4 py-2 text-body-sm text-on-accent hover:bg-accent-hover">
            {state === 'other' ? t('continue') : t('signIn')}
          </button>
        </div>
      </div>
    </div>
  )
}
