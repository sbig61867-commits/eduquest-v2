'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Languages } from 'lucide-react'

import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS, type Locale } from '@/i18n/config'

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
 * NOTE: this only persists in this browser. Persisting per user needs
 * `users.locale`, which is what supabase/locale_preferences_migration.sql
 * adds; the resolution chain already prefers it over the cookie once present.
 */
// Module scope on purpose: the react-hooks lint rule reads an assignment to
// `document.cookie` inside a component as mutating an outer binding.
export function writeLocaleCookie(next: Locale) {
  const { path, maxAge, sameSite } = LOCALE_COOKIE_OPTIONS
  document.cookie = `${LOCALE_COOKIE}=${next}; path=${path}; max-age=${maxAge}; samesite=${sameSite}`
}

export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const active = useLocale() as Locale
  const t = useTranslations('common.locale')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function pick(next: Locale) {
    if (next === active) return
    writeLocaleCookie(next)
    startTransition(() => router.refresh())
  }

  return (
    <div
      className={`flex items-center gap-1 rounded-lg border border-slate-700 p-0.5 ${pending ? 'opacity-60' : ''} ${className}`}
      role="group"
      aria-label={t('switchLabel')}
    >
      <Languages className="w-3.5 h-3.5 text-slate-500 mx-1 shrink-0" aria-hidden />
      {LOCALES.map(loc => (
        <button
          key={loc}
          type="button"
          onClick={() => pick(loc)}
          aria-pressed={loc === active}
          disabled={pending}
          // The label is always written in its OWN language, never translated:
          // someone stuck in a language they cannot read must still recognise
          // the way out.
          lang={loc}
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            loc === active
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          {t(loc)}
        </button>
      ))}
    </div>
  )
}
