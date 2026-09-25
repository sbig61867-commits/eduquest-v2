// Wording of the /pricing page, one file per language (src/content/pricing/{ar,en}.ts).
// Plan ids and prices are in src/lib/pricing/plans.ts; `plans` here is keyed by
// those ids, so a plan without wording in either language is a type error.
import type { PlanId } from '@/lib/pricing/plans'

export interface PlanText {
  name: string
  tagline: string
  badge?: string
  cta: string
  features: string[]
}

export interface PricingText {
  /** Shown next to every number. */
  currency: string
  /** Displayed under the page title, e.g. after a price change. */
  lastUpdated: string
  plans: Record<PlanId, PlanText>
  /** Bullets shown once under the cards — true for every plan. */
  includedInAll: string[]
  faqs: { q: string; a: string }[]
}
