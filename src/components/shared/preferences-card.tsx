'use client'

import { useTranslations } from 'next-intl'
import { ThemeToggle } from '@/components/public/theme-toggle'
import { LocaleSwitcher } from './locale-switcher'

/**
 * The signed-in user's own preferences: interface language and appearance.
 * Lives on each role's settings page, not in the header, so the top bar stays
 * for navigation and account only.
 */
export function PreferencesCard() {
  const t = useTranslations('common.account')
  return (
    <section aria-labelledby="prefs-title" className="rounded-overlay border border-line bg-surface p-6">
      <h2 id="prefs-title" className="text-h3 text-fg">{t('preferences')}</h2>
      <div className="mt-4 divide-y divide-line">
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-body-sm text-fg-2">{t('language')}</span>
          <LocaleSwitcher />
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-body-sm text-fg-2">{t('appearance')}</span>
          <ThemeToggle />
        </div>
      </div>
    </section>
  )
}
