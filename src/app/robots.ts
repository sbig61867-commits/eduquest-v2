import type { MetadataRoute } from 'next'
import { siteUrl } from '@/i18n/public-routes'

// Without this file, /robots.txt fell through proxy.ts (not a public route)
// and redirected crawlers to /login, so they received an HTML page instead
// of crawl rules — Lighthouse flagged it as "robots.txt is not valid".
// '/robots.txt' is also listed in proxy.ts PUBLIC_EXACT for that reason.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Authenticated dashboards and API routes have nothing to index.
      disallow: ['/api/', '/student/', '/teacher/', '/admin/', '/center/', '/super-admin/', '/join/'],
    },
    host: base,
    sitemap: `${base}/sitemap.xml`,
  }
}
