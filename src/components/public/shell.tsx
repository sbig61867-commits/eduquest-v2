'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { writeLocaleCookie } from '@/lib/locale-cookie'
import { pricingEnabled } from '@/lib/pricing/plans'
import type { Locale } from '@/i18n/config'
import { currentMarketingPath, localizedPath } from '@/i18n/public-routes'
import { WRAP } from './ui'
import { BrandMark } from '@/components/shared/brand-mark'

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
  const f = useTranslations('public.shell.footer')
  const columns: { title: string; links: { label: string; href: string }[] }[] = [
    {
      title: f('platform'),
      links: [
        { label: f('features'), href: localizedPath(lang, '/features') },
        { label: f('ai'), href: localizedPath(lang, '/ai') },
        { label: f('security'), href: localizedPath(lang, '/security') },
        ...(pricingEnabled ? [{ label: t('pricing'), href: localizedPath(lang, '/pricing') }] : []),
      ],
    },
    {
      title: f('institution'),
      links: [
        { label: f('about'), href: localizedPath(lang, '/about') },
        { label: f('demo'), href: localizedPath(lang, '/demo') },
        { label: f('contact'), href: localizedPath(lang, '/contact') },
      ],
    },
    {
      title: f('policies'),
      links: [
        { label: t('privacy'), href: localizedPath(lang, '/privacy') },
        { label: t('terms'), href: localizedPath(lang, '/terms') },
      ],
    },
  ]

  return (
    <footer className="border-t border-slate-800 mt-16 bg-slate-950">
      <div className={`${WRAP} py-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]`}>
        <div className="sm:col-span-2 lg:col-span-1 max-w-sm">
          <Link href={localizedPath(lang, '/')} dir="ltr" className="eq-brand inline-flex items-center gap-2.5">
            <BrandMark size={36} />
            <span className="eq-wordmark font-bold text-lg">EduQuest</span>
          </Link>
          <p className="text-slate-400 text-sm mt-4 leading-relaxed">{f('tagline')}</p>
        </div>
        {columns.map(col => (
          <nav key={col.title} aria-label={col.title}>
            <p className="text-white text-sm font-semibold">{col.title}</p>
            <ul className="mt-4 space-y-3">
              {col.links.map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-slate-400 hover:text-white text-sm transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-slate-800/80">
        <p className={`${WRAP} py-6 text-slate-500 text-sm`}>© {new Date().getFullYear()} EduQuest. {t('rights')}</p>
      </div>
    </footer>
  )
}
