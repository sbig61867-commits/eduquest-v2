import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS, type Locale } from '@/i18n/config'

/**
 * Writes the UI-language cookie in the browser (deliberately not HttpOnly —
 * see src/i18n/config.ts). Its own dependency-free module on purpose: the
 * public pages import it, and when it lived in locale-switcher.tsx it dragged
 * the Supabase client into every public page (perf audit 2026-09-30).
 * Module scope, not inside a component: the react-hooks lint rule reads an
 * assignment to `document.cookie` there as mutating an outer binding.
 */
export function writeLocaleCookie(next: Locale) {
  const { path, maxAge, sameSite } = LOCALE_COOKIE_OPTIONS
  document.cookie = `${LOCALE_COOKIE}=${next}; path=${path}; max-age=${maxAge}; samesite=${sameSite}`
}
