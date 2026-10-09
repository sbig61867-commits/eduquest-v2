'use client'

import { useLocale } from 'next-intl'
import { useState } from 'react'

import { type Locale } from '@/i18n/config'
import { writeLocaleCookie } from '@/lib/locale-cookie'
import { LocaleToggle } from '@/components/public/locale-toggle'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Switches the UI language for this browser.
 *
 * Writes `eq_locale` directly — the cookie is deliberately not HttpOnly for
 * exactly this reason (see src/i18n/config.ts) — then reloads the whole page
 * (owner's rule 2026-10-09: a language or theme switch is always a full reload,
 * so no client-rendered text stays in the old language).
 *
 * `lang`/`dir` on <html> come from the same cookie in the root layout, so the
 * direction flips with the language from one source of truth.
 *
 * For a signed-in user the choice is also saved to `users.locale` (a plain
 * self-update that RLS allows — supabase/tests/locale_rls_check.sql), so it
 * follows them to another browser or device: src/proxy.ts reads it into the
 * cookie on the first request that arrives without one. Saving is
 * best-effort — the switch itself never waits on it or fails because of it.
 */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const active = useLocale() as Locale
  const [pending, setPending] = useState(false)
  const userId = useAuthStore(s => s.user?.id)

  async function pick(next: Locale) {
    if (next === active || pending) return
    setPending(true)
    writeLocaleCookie(next)
    if (userId) {
      // Best-effort, but give it a moment to land before the reload aborts it.
      const save = createClient().from('users').update({ locale: next }).eq('id', userId)
        .then(({ error }) => { if (error) console.warn('[locale] preference not saved:', error.message) })
      await Promise.race([save, new Promise(r => setTimeout(r, 1500))])
    }
    window.location.reload()
  }

  // Same compact EN · AR pill as the public pages, so the language switch
  // looks the same before and after sign-in.
  return (
    <div className={`shrink-0 ${pending ? 'opacity-60 pointer-events-none' : ''} ${className}`}>
      <LocaleToggle active={active} onPick={pick} />
    </div>
  )
}
