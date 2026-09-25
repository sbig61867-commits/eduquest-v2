/**
 * Locale-prefixed URLs for the public marketing pages — and ONLY those.
 *
 * The app behind login resolves its language from the `eq_locale` cookie and
 * has no locale in the URL: nothing there is indexed, and prefixing every
 * dashboard route would buy nothing. The marketing pages are the opposite —
 * a search engine indexes one URL per language, so each needs its own:
 *
 *     /ar/pricing  /en/pricing        (canonical, what links point to)
 *     /pricing                         (still served; renders the cookie locale)
 *
 * No route files move. src/proxy.ts rewrites `/<locale><path>` to `<path>` and
 * passes the locale on the LOCALE_HEADER request header, which
 * src/i18n/runtime.ts prefers over the cookie. Dependency-free on purpose, so
 * the proxy (edge), server components and client components can all import it.
 */

import { LOCALES, type Locale, isLocale } from './config'

/** Request header the proxy uses to hand a URL locale to the renderer. */
export const LOCALE_HEADER = 'x-eq-locale'

/** Marketing pages that exist in both languages. */
export const MARKETING_PATHS = ['/', '/features', '/pricing', '/contact', '/privacy', '/terms'] as const
export type MarketingPath = (typeof MARKETING_PATHS)[number]

export function isMarketingPath(path: string): path is MarketingPath {
  return (MARKETING_PATHS as readonly string[]).includes(path)
}

/** `('en', '/pricing')` → `/en/pricing`; `('ar', '/')` → `/ar`. */
export function localizedPath(locale: Locale, path: MarketingPath): string {
  return path === '/' ? `/${locale}` : `/${locale}${path}`
}

/**
 * `/en/pricing` → `{ locale: 'en', path: '/pricing' }`. Returns null for
 * anything that is not a locale prefix in front of a marketing page, so
 * `/en/admin` or `/english` are never rewritten.
 */
export function splitLocalizedPath(pathname: string): { locale: Locale; path: MarketingPath } | null {
  const match = /^\/([a-z]{2})(\/.*)?$/.exec(pathname)
  if (!match || !isLocale(match[1])) return null
  const rest = match[2] && match[2] !== '/' ? match[2].replace(/\/$/, '') : '/'
  return isMarketingPath(rest) ? { locale: match[1], path: rest } : null
}

/**
 * The marketing path of the page currently open, with any locale prefix
 * removed — for the language switcher. Anything unexpected maps to '/'.
 */
export function currentMarketingPath(pathname: string): MarketingPath {
  const split = splitLocalizedPath(pathname)
  if (split) return split.path
  const bare = pathname !== '/' ? pathname.replace(/\/$/, '') : '/'
  return isMarketingPath(bare) ? bare : '/'
}

/**
 * `alternates` for a marketing page's metadata: canonical URL in the rendered
 * locale, one hreflang entry per locale, and `x-default` on the unprefixed URL
 * (which serves the visitor's own language). Relative URLs — resolved against
 * `metadataBase` in the root layout.
 */
export function marketingAlternates(path: MarketingPath, locale: Locale) {
  const languages: Record<string, string> = {}
  for (const l of LOCALES) languages[l] = localizedPath(l, path)
  languages['x-default'] = path
  return { canonical: localizedPath(locale, path), languages }
}

/** Absolute site origin for metadata, robots and the sitemap (no trailing slash). */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://eduquest-v2.vercel.app').replace(/\/$/, '')
}
