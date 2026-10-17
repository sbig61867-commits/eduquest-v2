import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { ScopedIntlProvider } from '@/i18n/provider'
import { toLocale } from '@/i18n/config'
import { marketingAlternates, type MarketingPath } from '@/i18n/public-routes'
import type { Messages } from '@/i18n/messages'

type MetaKey = 'home' | 'features' | 'pricing' | 'about' | 'security' | 'ai' | 'demo' | 'contact' | 'privacy' | 'terms'

/**
 * Title, description and the per-language URLs (canonical + hreflang) for a
 * marketing page. See src/i18n/public-routes.ts for the URL scheme.
 */
export async function marketingMetadata(key: MetaKey, path: MarketingPath): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations(`public.meta.${key}`), getLocale()])
  return {
    title: t('title'),
    description: t('description'),
    alternates: marketingAlternates(path, toLocale(locale)),
    openGraph: { locale: toLocale(locale) === 'ar' ? 'ar_AR' : 'en_US' },
  }
}

/** A top-level section of the `public` messages (one per marketing page, plus `shell`). */
export type PublicSection = keyof Messages['public']

/**
 * Ships the page's own `public` section (plus `shell`: nav, menu, footer) to
 * its client components, and opens the `.eq-public` scope that carries the
 * light/dark appearance (src/app/globals.css, src/lib/theme.ts).
 *
 * Only the named sections: `public` holds the copy of every marketing page,
 * and sending all of it put ~14 KB gzip of other pages' text into each page
 * (measured on /ar, 2026-10-17). src/__tests__/marketing-sections.test.ts
 * checks each page names every section its components read.
 */
export function MarketingPage({ sections, children }: { sections: readonly PublicSection[]; children: React.ReactNode }) {
  return (
    <ScopedIntlProvider namespaces={['common', 'public']} only={{ public: ['shell', ...sections] }}>
      <div className="eq-public">{children}</div>
    </ScopedIntlProvider>
  )
}
