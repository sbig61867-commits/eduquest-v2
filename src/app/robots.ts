import type { MetadataRoute } from 'next'

// Without this file, /robots.txt fell through proxy.ts (not a public route)
// and redirected crawlers to /login, so they received an HTML page instead
// of crawl rules — Lighthouse flagged it as "robots.txt is not valid".
// '/robots.txt' is also listed in proxy.ts PUBLIC_EXACT for that reason.
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://eduquest-v2.vercel.app').replace(/\/$/, '')
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Authenticated dashboards and API routes have nothing to index.
      disallow: ['/api/', '/student/', '/teacher/', '/admin/', '/center/', '/super-admin/', '/join/'],
    },
    host: base,
  }
}
