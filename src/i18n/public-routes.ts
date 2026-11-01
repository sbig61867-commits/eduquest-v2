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

/** Marketing pages that exist in both languages (role tours are listed below). */
const PAGE_PATHS = ['/', '/features', '/pricing', '/about', '/security', '/ai', '/demo', '/contact', '/privacy', '/terms', '/legal',
  '/solutions/universities', '/solutions/institutes', '/solutions/training-centres', '/solutions/schools'] as const

/** Institution type of each /solutions/<slug> page. */
export const SOLUTION_SLUGS = {
  university: 'universities', institute: 'institutes', training_center: 'training-centres', school: 'schools',
} as const
export type DemoInstitutionType = keyof typeof SOLUTION_SLUGS

/** Role tours: each role's dashboard ('') and the pages of its sidebar. */
export const DEMO_ROLE_PAGES = {
  student: ['', 'courses', 'exams', 'grades', 'schedule'],
  teacher: ['', 'groups', 'exams', 'requests', 'schedule'],
  admin: ['', 'courses', 'teachers', 'students', 'groups'],
  center: ['', 'groups', 'schedules', 'announcements', 'requests'],
} as const
export type DemoRole = keyof typeof DEMO_ROLE_PAGES
export const DEMO_ROLES = Object.keys(DEMO_ROLE_PAGES) as DemoRole[]

/** Base of a role tour: /demo (the university fixtures) or /solutions/<slug>. */
export type RoleTourBase = '/demo' | `/solutions/${(typeof SOLUTION_SLUGS)[DemoInstitutionType]}`
export type RoleTourPath = `${RoleTourBase}/${DemoRole}` | `${RoleTourBase}/${DemoRole}/${string}`

export function roleTourPath(base: RoleTourBase, role: DemoRole, page = ''): RoleTourPath {
  return page ? `${base}/${role}/${page}` : `${base}/${role}`
}

const ROLE_TOUR_PATHS: RoleTourPath[] = (['/demo', ...Object.values(SOLUTION_SLUGS).map(s => `/solutions/${s}` as const)] as RoleTourBase[])
  .flatMap(base => DEMO_ROLES.flatMap(role => DEMO_ROLE_PAGES[role].map(page => roleTourPath(base, role, page))))

export const MARKETING_PATHS: readonly MarketingPath[] = [...PAGE_PATHS, ...ROLE_TOUR_PATHS]
export type MarketingPath = (typeof PAGE_PATHS)[number] | RoleTourPath

const MARKETING_SET = new Set<string>(MARKETING_PATHS)
export function isMarketingPath(path: string): path is MarketingPath {
  return MARKETING_SET.has(path)
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
