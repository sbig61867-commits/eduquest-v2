import type { Locale } from '@/i18n/config'
import type { PricingText } from '@/content/pricing/types'
import { pricingText as ar } from '@/content/pricing/ar'
import { pricingText as en } from '@/content/pricing/en'

// الملف الوحيد الذي تُعدَّل فيه الأسعار.
// Single source of truth for the public /pricing page. Change numbers here; plan names,
// features, currency and FAQ are in src/content/pricing/{ar,en}.ts. The page updates — no layout or
// component edits needed. Everything is typed, so a missing or renamed field is
// a build error, never a silently blank card.
//
// - `priceMonthly` / `priceYearly`: a number renders as a price; `null` renders
//   the plan as "on request" and hides the billing toggle for that card.
// - Set `highlight: true` on exactly one plan to give it the accent border.
// - `showBillingToggle: false` hides the monthly/yearly switch site-wide.
//
// ملاحظة: الأرقام الحالية مبدئية — استبدلها بأسعارك الفعلية.

/**
 * قسم الأسعار مخفي حالياً: الروابط في الهيدر/الفوتر لا تظهر و /pricing تُرجع 404.
 * غيّرها إلى true لإظهار القسم مرة أخرى — لا حاجة لأي تعديل آخر.
 */
export const pricingEnabled = false

export type BillingPeriod = 'monthly' | 'yearly'

export type PlanId = 'pilot' | 'institution' | 'university'

export interface PricingPlan {
  id: PlanId
  /** Accent card + 'most popular' badge. Keep at most one. */
  highlight?: boolean
  priceMonthly: number | null
  priceYearly: number | null
}

export interface PricingConfig {
  showBillingToggle: boolean
  plans: PricingPlan[]
}

// Numbers and switches only. Plan names, features, FAQ, currency and the
// 'prices updated' line are worded per language in src/content/pricing/{ar,en}.ts.
export const pricing: PricingConfig = {
  showBillingToggle: true,
  plans: [
    { id: 'pilot', priceMonthly: 0, priceYearly: 0 },
    { id: 'institution', highlight: true, priceMonthly: 149, priceYearly: 1490 },
    { id: 'university', priceMonthly: null, priceYearly: null },
  ],
}

/** The pricing page's wording in `locale`. */
export function pricingText(locale: Locale): PricingText {
  return locale === 'ar' ? ar : en
}
