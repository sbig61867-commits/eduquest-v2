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

/**
 * Usage limits of a plan. `null` = set per agreement (never "unlimited": the
 * platform has hard infrastructure ceilings, see PLATFORM_CAPACITY).
 * The pilot's AI and live-proctoring figures cover the whole 30-day trial;
 * the paid plans' figures are per month.
 */
export interface PlanLimits {
  /** Active students (enforced: tenants.student_limit, src/lib/student-limit.ts). */
  students: number | null
  /** Instructors and staff accounts. */
  staff: number | null
  /** Metered AI requests (tenants.ai_monthly_request_limit once the metering migration is applied). */
  aiRequests: number | null
  /** LiveKit participant-minutes: every connected student and the watching instructor count one per minute. */
  liveMinutes: number | null
  /** Students in live-proctored examinations at the same moment. */
  liveConcurrent: number | null
  /** Uploaded files in Supabase Storage (images, answer photos, attachments), in MB.
   *  Proctoring snapshots are NOT counted: they live outside Supabase for 30 hours only. */
  storageMb: number | null
}

export type LimitKey = keyof PlanLimits
export const LIMIT_KEYS: LimitKey[] = ['students', 'staff', 'aiRequests', 'liveMinutes', 'liveConcurrent', 'storageMb']

export interface PricingPlan {
  id: PlanId
  /** Accent card + 'most popular' badge. Keep at most one. */
  highlight?: boolean
  priceMonthly: number | null
  priceYearly: number | null
  limits: PlanLimits
  /** The plan for an institution with several faculties or centres. */
  multiUnit?: boolean
}

export interface PricingConfig {
  showBillingToggle: boolean
  plans: PricingPlan[]
}

/**
 * What the CURRENT infrastructure can carry for all institutions together,
 * with ~20% headroom. Reviewed 2026-09-26 against the providers' published
 * free tiers and the platform's own caps:
 *
 *   Supabase Free   500 MB database · 1 GB storage · 5 GB egress / month.
 *                   Estimated ~0.5 MB database, ~1 MB files and ~6 MB egress
 *                   per active student per year/month (answers + proctoring
 *                   events per exam, progress, attendance; proctoring
 *                   snapshots are kept outside Supabase, src/lib/evidence-keys.ts)
 *                   ⇒ each resource alone
 *                   tops out near 800–1,000 students. No automatic backups.
 *   LiveKit Build   5,000 participant-minutes / month · 100 concurrent
 *                   connections, a HARD cap: overlapping live-proctored
 *                   exams across all institutions share it.
 *   AI (free legs)  Groq gpt-oss-120b 1,000 requests and 200K tokens / day,
 *                   plus the other free providers in src/lib/ai/chat.ts ⇒ a
 *                   safe budget of ~6,000 metered requests / month.
 *   Vercel Hobby    free, but restricted to NON-COMMERCIAL use: charging for
 *                   a plan requires Vercel Pro first.
 *
 * Plan limits below are sized so that a realistic mix (two paying
 * institutions + four concurrent trials) stays inside these numbers — see
 * src/__tests__/pricing-advisor.test.ts. Raise them only after upgrading the
 * infrastructure (Supabase Pro: 8 GB · 100 GB · 250 GB; LiveKit Ship: 150K min).
 */
export const PLATFORM_CAPACITY: Record<Exclude<LimitKey, 'staff'>, number> = {
  students: 800,
  aiRequests: 6_000,
  liveMinutes: 4_000,
  liveConcurrent: 90,
  storageMb: 800,
}

// Numbers and switches only. Plan names, features, FAQ, currency and the
// 'prices updated' line are worded per language in src/content/pricing/{ar,en}.ts.
export const pricing: PricingConfig = {
  showBillingToggle: true,
  plans: [
    {
      id: 'pilot', priceMonthly: 0, priceYearly: 0,
      limits: { students: 50, staff: 5, aiRequests: 150, liveMinutes: 500, liveConcurrent: 7, storageMb: 50 },
    },
    {
      id: 'institution', highlight: true, priceMonthly: 149, priceYearly: 1490,
      limits: { students: 250, staff: 25, aiRequests: 1_500, liveMinutes: 1_000, liveConcurrent: 30, storageMb: 250 },
    },
    {
      id: 'university', priceMonthly: null, priceYearly: null, multiUnit: true,
      limits: { students: null, staff: null, aiRequests: null, liveMinutes: null, liveConcurrent: null, storageMb: null },
    },
  ],
}

/** Why the advisor picked a plan (keys of `pricingPage.advisor.reasons`). */
export type AdvisorReason = 'pilot' | 'institution' | 'scale' | 'structure'

/**
 * The plan advisor on /pricing: the first plan whose student ceiling fits,
 * or the multi-unit plan (limits by agreement) when the institution has
 * several faculties/centres or outgrows every ceiling. Driven only by
 * `pricing`, so changing a ceiling above changes the advice too.
 */
export function recommendPlan(students: number, multiUnit: boolean): { id: PlanId; reason: AdvisorReason } {
  const open = pricing.plans.find(p => p.limits.students === null) ?? pricing.plans[pricing.plans.length - 1]
  if (multiUnit) return { id: (pricing.plans.find(p => p.multiUnit) ?? open).id, reason: 'structure' }
  const fits = pricing.plans.find(p => !p.multiUnit && p.limits.students !== null && students <= p.limits.students)
  if (!fits) return { id: open.id, reason: 'scale' }
  return { id: fits.id, reason: fits.priceMonthly === 0 ? 'pilot' : 'institution' }
}

/** The pricing page's wording in `locale`. */
export function pricingText(locale: Locale): PricingText {
  return locale === 'ar' ? ar : en
}
