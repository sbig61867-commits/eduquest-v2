'use client'

import { useTranslations } from 'next-intl'
import { applyTheme, effectiveTheme, type Theme } from '@/lib/theme'

// Two-segment appearance switch (sun · moon), the same pill as LocaleToggle,
// used on the public surface AND in the signed-in header.
//
// No React state: which segment is lit is decided in CSS by the `eq-light`
// variant (src/app/globals.css), so the first paint is already right for a
// cookie choice and for the system setting alike. A pick reloads the page
// (applyTheme). Fixed LTR order so the pill does not flip with the direction.
const SEGMENT = 'eq-focus flex items-center justify-center w-8 h-7 rounded-full transition-colors'
const ON = 'bg-accent text-on-accent'
const OFF = 'text-fg-3 hover:text-fg'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useTranslations('common.theme')
  const pick = (next: Theme) => { if (effectiveTheme() !== next) applyTheme(next) }
  return (
    <div role="group" aria-label={t('toggle')} dir="ltr" className={`flex items-center p-0.5 rounded-full border border-line-strong bg-surface ${className}`}>
      <button type="button" onClick={() => pick('light')} aria-label={t('light')} title={t('light')}
        className={`${SEGMENT} ${OFF} eq-light:bg-accent eq-light:text-on-accent eq-light:hover:text-on-accent`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </button>
      <button type="button" onClick={() => pick('dark')} aria-label={t('dark')} title={t('dark')}
        className={`${SEGMENT} ${ON} eq-light:bg-transparent eq-light:text-fg-3 eq-light:hover:text-fg`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      </button>
    </div>
  )
}
