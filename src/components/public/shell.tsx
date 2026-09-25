'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { writeLocaleCookie } from '@/components/shared/locale-switcher'
import { pricingEnabled } from '@/lib/pricing/plans'
import type { Locale } from '@/i18n/config'
import { currentMarketingPath, localizedPath } from '@/i18n/public-routes'

export type Lang = Locale

// Language state for the public (pre-login) pages.
//
// Reads the active locale from next-intl — which the proxy resolved from the
// URL (`/en/...`) or, on an unprefixed URL, the `eq_locale` cookie. Switching
// language NAVIGATES to the other locale's URL: each language has its own
// indexable address, and the proxy sets the cookie on arrival so the choice
// carries through sign-in.
//
// A full page load, not router.push: the language lives in the ROOT layout
// (<html lang dir> and the root message provider), and a client-side
// navigation keeps the root layout mounted — the URL would change while the
// page stayed in the old language.
export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useLocale() as Lang
  const setLang = (l: Lang) => {
    if (l === lang) return
    writeLocaleCookie(l)
    window.location.assign(localizedPath(l, currentMarketingPath(window.location.pathname)))
  }
  return [lang, setLang]
}

// The header lives in ./public-nav (mega-menu, hide-on-scroll).
export { PublicNav } from './public-nav'

export function PublicFooter({ lang }: { lang: Lang }) {
  const t = useTranslations('public.shell')
  return (
    <footer className="border-t border-slate-800 mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-slate-400 text-sm">© {new Date().getFullYear()} EduQuest. {t('rights')}</p>
        <div className="flex items-center gap-5 text-sm">
          {pricingEnabled && <Link href={localizedPath(lang, '/pricing')} className="text-slate-400 hover:text-white transition-colors">{t('pricing')}</Link>}
          <Link href={localizedPath(lang, '/privacy')} className="text-slate-400 hover:text-white transition-colors">{t('privacy')}</Link>
          <Link href={localizedPath(lang, '/terms')} className="text-slate-400 hover:text-white transition-colors">{t('terms')}</Link>
          <Link href={localizedPath(lang, '/contact')} className="text-slate-400 hover:text-white transition-colors">{t('contactUs')}</Link>
        </div>
      </div>
    </footer>
  )
}
