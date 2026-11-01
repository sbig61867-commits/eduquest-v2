'use client'

import { useRouter } from 'next/navigation'
import type { Locale } from '@/i18n/config'
import { LocaleToggle } from '@/components/public/locale-toggle'
import { ThemeToggle } from '@/components/public/theme-toggle'

// The only interactive pieces of a role tour: appearance and language. The
// language lives in the URL (/ar/… or /en/…), so a pick navigates instead of
// writing a cookie, and the page stays edge cacheable.
export function RoleTourControls({ locale, hrefs }: { locale: Locale; hrefs: Record<Locale, string> }) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-2 shrink-0">
      <ThemeToggle />
      <LocaleToggle active={locale} onPick={l => router.push(hrefs[l])} />
    </div>
  )
}
