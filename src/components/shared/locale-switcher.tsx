'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS, type Locale } from '@/i18n/config'
import { LocaleToggle } from '@/components/public/locale-toggle'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Switches the UI language for this browser.
 *
 * Writes `eq_locale` directly — the cookie is deliberately not HttpOnly for
 * exactly this reason (see src/i18n/config.ts) — then calls `router.refresh()`
 * so the server re-renders with the new locale. A full reload would also work
 * but throws away client state for no reason.
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
// Module scope on purpose: the react-hooks lint rule reads an assignment to
// `document.cookie` inside a component as mutating an outer binding.
export function writeLocaleCookie(next: Locale) {
  const { path, maxAge, sameSite } = LOCALE_COOKIE_OPTIONS
  document.cookie = `${LOCALE_COOKIE}=${next}; path=${path}; max-age=${maxAge}; samesite=${sameSite}`
}

export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const active = useLocale() as Locale
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const userId = useAuthStore(s => s.user?.id)

  function pick(next: Locale) {
    if (next === active) return
    writeLocaleCookie(next)
    startTransition(() => router.refresh())
    if (userId) {
      void createClient().from('users').update({ locale: next }).eq('id', userId)
        .then(({ error }) => { if (error) console.warn('[locale] preference not saved:', error.message) })
    }
  }

  // Same compact EN · AR pill as the public pages, so the language switch
  // looks the same before and after sign-in.
  return (
    <div className={`shrink-0 ${pending ? 'opacity-60 pointer-events-none' : ''} ${className}`}>
      <LocaleToggle active={active} onPick={pick} />
    </div>
  )
}
