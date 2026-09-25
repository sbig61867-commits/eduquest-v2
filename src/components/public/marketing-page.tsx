import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { ScopedIntlProvider } from '@/i18n/provider'
import { toLocale } from '@/i18n/config'
import { marketingAlternates, type MarketingPath } from '@/i18n/public-routes'

type MetaKey = 'home' | 'features' | 'pricing' | 'contact' | 'privacy' | 'terms'

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

/** Ships the `public` messages to a marketing page's client components. */
export function MarketingPage({ children }: { children: React.ReactNode }) {
  return <ScopedIntlProvider namespaces={['common', 'public']}>{children}</ScopedIntlProvider>
}
