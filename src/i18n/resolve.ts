/**
 * Locale resolution.
 *
 * Precedence (highest first):
 *   1. explicit  — a locale the caller states outright. Used by controlled
 *                  server-side operations that must render in *someone else's*
 *                  language: invitation emails, PDF/xlsx reports. Without this
 *                  an email sent by an Arabic-speaking admin to an English
 *                  student would come out Arabic. (Phase 0a proved this fails
 *                  silently when `requestLocale` is ignored — see C2.)
 *   2. user      — users.locale
 *   3. tenant    — tenants.default_locale
 *   4. platform  — DEFAULT_LOCALE
 *
 * PERFORMANCE CONTRACT — read this before adding anything to this file.
 *
 * Levels 2 and 3 live in the database, but the steady-state authenticated
 * request must NOT query it. The chain is therefore collapsed **once** into
 * the `eq_locale` cookie (src/proxy.ts) and every subsequent request reads the
 * cookie alone: zero DB round-trips, same discipline as the JWT-claims fast
 * path in the proxy. `resolveLocale()` below is pure — it has no idea a
 * database exists — so it is equally usable in the proxy, in a test, and in a
 * report builder.
 */

import { DEFAULT_LOCALE, isLocale, type Locale } from './config'

export interface LocaleSources {
  /** Stated outright by the caller (report/email language). Wins over all. */
  explicit?: unknown
  /** users.locale — NULL means "inherit from the tenant". */
  user?: unknown
  /** tenants.default_locale. */
  tenant?: unknown
}

/**
 * Pure precedence resolution. Any value that is not a supported locale —
 * null, undefined, '', 'fr', 42 — is skipped, not defaulted, so a junk
 * `user` value still lets the `tenant` default apply.
 */
export function resolveLocale(sources: LocaleSources = {}): Locale {
  const { explicit, user, tenant } = sources
  if (isLocale(explicit)) return explicit
  if (isLocale(user)) return user
  if (isLocale(tenant)) return tenant
  return DEFAULT_LOCALE
}

/**
 * Which level actually decided — used by the proxy to know whether the answer
 * is worth persisting into a cookie, and by tests to prove precedence rather
 * than merely prove the final string.
 */
export type LocaleSource = 'explicit' | 'user' | 'tenant' | 'platform'

export function resolveLocaleWithSource(
  sources: LocaleSources = {}
): { locale: Locale; source: LocaleSource } {
  const { explicit, user, tenant } = sources
  if (isLocale(explicit)) return { locale: explicit, source: 'explicit' }
  if (isLocale(user)) return { locale: user, source: 'user' }
  if (isLocale(tenant)) return { locale: tenant, source: 'tenant' }
  return { locale: DEFAULT_LOCALE, source: 'platform' }
}

/**
 * Cookie value → locale. An absent, malformed or unsupported cookie falls back
 * to the platform default rather than throwing: a bad cookie must never be
 * able to 500 a page.
 */
export function localeFromCookie(value: string | undefined | null): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}
