import type { Locale } from '@/i18n/config'

// Number formatting for the AI usage screens. Latin digits in both languages
// (same rule as formatDate in lib/utils.ts), so figures read the same in the
// Arabic and English UI and match what the CSV export contains.
const NUM_LOCALE: Record<Locale, string> = {
  ar: 'ar-u-nu-latn',
  en: 'en-u-nu-latn',
}
const DATE_LOCALE: Record<Locale, string> = {
  ar: 'ar-u-ca-gregory-nu-latn',
  en: 'en-u-ca-gregory-nu-latn',
}

export interface UsageFormatters {
  int: (n: number) => string
  compact: (n: number) => string
  usd: (n: number) => string
  pct: (ratio: number) => string
  duration: (ms: number | null) => string
  day: (isoDay: string) => string
}

export function usageFormatters(locale: Locale): UsageFormatters {
  const loc = NUM_LOCALE[locale] ?? NUM_LOCALE.en
  const int = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 })
  const compact = new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 })
  const usdWhole = new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // Sub-dollar amounts are the norm on free-tier volumes: show 3 significant
  // digits so $0.00045 does not collapse into "$0.00".
  const usdSmall = new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', maximumSignificantDigits: 3 })
  const pct = new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 1 })
  const seconds = new Intl.NumberFormat(loc, { style: 'unit', unit: 'second', maximumFractionDigits: 1 })
  const millis = new Intl.NumberFormat(loc, { style: 'unit', unit: 'millisecond', maximumFractionDigits: 0 })
  const day = new Intl.DateTimeFormat(DATE_LOCALE[locale] ?? DATE_LOCALE.en, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })

  return {
    int: n => int.format(n),
    compact: n => (Math.abs(n) < 10_000 ? int.format(n) : compact.format(n)),
    usd: n => (n === 0 ? usdWhole.format(0) : Math.abs(n) < 1 ? usdSmall.format(n) : usdWhole.format(n)),
    pct: r => pct.format(r),
    duration: ms => (ms == null ? '·' : ms >= 1000 ? seconds.format(ms / 1000) : millis.format(ms)),
    day: d => day.format(new Date(`${d}T00:00:00Z`)),
  }
}
