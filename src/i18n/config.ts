/**
 * i18n foundation — static configuration.
 *
 * Deliberately dependency-free (no next-intl, no `next/*`, no Supabase) so it
 * can be imported from the proxy/edge runtime, from server components, from
 * client components and from a plain unit test without dragging anything else
 * in. Everything here is a compile-time constant: adding a third locale is a
 * change to `LOCALES` + a new message directory, nothing more.
 */

export const LOCALES = ['en', 'ar'] as const
export type Locale = (typeof LOCALES)[number]

/**
 * Platform default — the LAST link of the chain (explicit → user → tenant →
 * platform), used only when nothing more specific is known: a first-time
 * visitor with no cookie, or an account with no institution (super_admin)
 * and no saved choice.
 *
 * `en` since 2026-09-25, when string extraction finished and both locales
 * reached full coverage. It does NOT change what institution members see:
 * every tenant carries its own `tenants.default_locale` (DB default 'ar'),
 * which outranks this constant.
 *
 * Separate axis: `en` is the *authoritative message baseline* — every key must
 * exist in src/messages/en and ar mirrors it (enforced by the parity test).
 */
export const DEFAULT_LOCALE: Locale = 'en'

/** Text direction per locale. A third locale adds one entry here. */
export const LOCALE_DIR: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  ar: 'rtl',
}

/** Human label for a locale, written in that locale (for the future switcher). */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
}

/**
 * Cookie that carries the resolved locale.
 *
 * Not `HttpOnly`: the future in-page language switcher must be able to write it
 * from the client without a round-trip. It carries no identity and no
 * authorization value — the worst a tampered value can do is show the wrong
 * language to its own owner, and `isLocale()` rejects anything unsupported.
 */
export const LOCALE_COOKIE = 'eq_locale'

export const LOCALE_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax',
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: false,
} as const

/** Runtime validation — the only place an `unknown` becomes a `Locale`. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Narrow to a supported locale, falling back to the platform default. */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}

export function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return LOCALE_DIR[locale]
}

/**
 * Message namespaces.
 *
 * `CLIENT_NAMESPACES` are the ones that may be serialized into a
 * `NextIntlClientProvider` payload; `SERVER_NAMESPACES` must never be — they
 * are rendered server-side only (emails, PDF/xlsx reports) and shipping them
 * to the browser would be pure dead weight on every page.
 *
 * The route-group namespaces exist so that a page under /admin never ships the
 * teacher or student dictionaries. See src/i18n/messages.ts (C1).
 */
export const SHARED_NAMESPACES = ['common', 'terms', 'auth'] as const

/**
 * `staff` is not a route group. It holds the strings of the components shared
 * by the admin and centre shells (requests inbox, announcements manager,
 * schedules, rosters), which belong to neither group alone — putting them in
 * `common` would ship them to every student page instead.
 */
export const ROUTE_NAMESPACES = ['admin', 'superAdmin', 'center', 'staff', 'teacher', 'student', 'public'] as const

export const SERVER_NAMESPACES = ['email', 'errors', 'reports'] as const

export const NAMESPACES = [
  ...SHARED_NAMESPACES,
  ...ROUTE_NAMESPACES,
  ...SERVER_NAMESPACES,
] as const

export type Namespace = (typeof NAMESPACES)[number]

/** Namespaces that are safe to hand to a client provider. */
export const CLIENT_NAMESPACES: readonly Namespace[] = [
  ...SHARED_NAMESPACES,
  ...ROUTE_NAMESPACES,
]
