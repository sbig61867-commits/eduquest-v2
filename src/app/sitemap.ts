import type { MetadataRoute } from 'next'
import { LOCALES } from '@/i18n/config'
import { MARKETING_PATHS, localizedPath, siteUrl } from '@/i18n/public-routes'
import { pricingEnabled } from '@/lib/pricing/plans'

// One entry per marketing page and language, each listing its sibling
// languages — so a search engine indexes /ar/… and /en/… as translations of
// one page instead of two competing ones. '/sitemap.xml' is in proxy.ts
// PUBLIC_EXACT, like robots.txt, or crawlers would be redirected to /login.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl()
  const paths = MARKETING_PATHS.filter(p => p !== '/pricing' || pricingEnabled)
  return paths.flatMap(path =>
    LOCALES.map(locale => ({
      url: `${base}${localizedPath(locale, path)}`,
      changeFrequency: 'monthly' as const,
      priority: path === '/' ? 1 : 0.7,
      alternates: {
        languages: Object.fromEntries(LOCALES.map(l => [l, `${base}${localizedPath(l, path)}`])),
      },
    }))
  )
}
