'use client'

import { useTranslations } from 'next-intl'
import { LOCALES, LOCALE_LABEL, type Locale } from '@/i18n/config'

// Compact two-letter language switch (EN · AR) for the public surface.
// Fixed LTR order so the pill does not flip sides with the page direction.
// What a pick does is the caller's business: the marketing pages navigate to
// the other language's URL, the sign-in page refreshes in place.
export function LocaleToggle({ active, onPick }: { active: Locale; onPick: (l: Locale) => void }) {
  const t = useTranslations('common.locale')
  return (
    <div role="group" aria-label={t('switchLabel')} dir="ltr" className="flex items-center p-0.5 rounded-full border border-line-strong bg-surface">
      {LOCALES.map(l => (
        <button
          key={l}
          type="button"
          onClick={() => l !== active && onPick(l)}
          lang={l}
          aria-pressed={l === active}
          aria-label={LOCALE_LABEL[l]}
          className={`eq-focus w-8 h-7 rounded-full text-label font-bold tracking-wide transition-colors ${
            l === active ? 'bg-accent text-on-accent' : 'text-fg-3 hover:text-fg'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
