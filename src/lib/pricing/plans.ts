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
  /** Active students (enforced: tenants.student_limit, src/lib/seat-limit.ts). */
  students: number | null
  /** Instructors (active teachers enforced: tenants.teacher_limit, src/lib/seat-limit.ts) and staff accounts. */
  staff: number | null
  /** Metered AI requests (tenants.ai_monthly_request_limit once the metering migration is applied). */
  aiRequests: number | null
  /** LiveKit participant-minutes: every connected student and the watching instructor count one per minute. */
  liveMinutes: number | null
  /** Students in live-proctored examinations at the same moment. */
  liveConcurrent: number | null
  /** Uploaded files in Supabase Storage (images, answer photos, attachments), in MB
   *  (enforced: tenants.storage_limit_mb, src/lib/storage-quota.ts).
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
 * with ~20% headroom. Re-verified 2026-09-28 against the providers' published
 * free tiers and the platform's own caps:
 *
 *   Supabase Free   500 MB database · 1 GB storage · 5 GB egress / month.
 *                   Estimated ~0.5 MB database, ~1 MB files and ~6 MB egress
 *                   per active student per year/month (answers + proctoring
 *                   events per exam, progress, attendance; proctoring
 *                   snapshots are kept outside Supabase, src/lib/evidence-keys.ts)
 *                   ⇒ each resource alone
 *                   tops out near 800–1,000 students. No automatic backups.
 *                   Realtime: 200 concurrent connections — every student in a
 *                   proctored exam joins the exam's live channel, so ~190
 *                   students platform-wide can appear on teachers' live pages
 *                   at one moment. Past that the exam goes on; the student is
 *                   just missing from the live list (use-exam-live-channel.ts).
 *   LiveKit Build   5,000 participant-minutes / month · 100 concurrent
 *                   connections, a HARD cap: overlapping live-proctored
 *                   exams across all institutions share it · 50 GB downstream
 *                   (not binding: 4,000 minutes at ≤900 kbps is under 30 GB).
 *   AI (free legs)  Groq gpt-oss-120b 1,000 requests and 200K tokens / day,
 *                   plus the other free providers in src/lib/ai/chat.ts ⇒ a
 *                   safe budget of ~6,000 metered requests / month.
 *   Workers KV      1,000 writes / day ⇒ at most ~1,000 proctoring snapshots
 *                   a day platform-wide (≤10 per student per exam).
 *   Vercel Hobby    free, but restricted to NON-COMMERCIAL use: charging for
 *                   a plan requires Vercel Pro first. Hobby also caps active
 *                   CPU at 4 hours / month — unmeasured at real load.
 *
 * Sizing: the capacity is split into HOSTED_INSTITUTIONS equal shares. One
 * `institution` plan is one share; a `pilot` runs inside a share (a trial is
 * an institution that has not paid yet) so its limits never exceed the
 * institution plan's; a `university` takes several shares by agreement,
 * which lowers the number of institutions hosted. See
 * src/__tests__/pricing-advisor.test.ts. Raise them only after upgrading the
 * infrastructure (Supabase Pro: 8 GB · 100 GB · 250 GB · 500 realtime;
 * LiveKit Ship: 150K min · 1,000 concurrent).
 */
export const HOSTED_INSTITUTIONS = 5

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
      // liveConcurrent 9 = one teacher's full live wall (MAX_WATCHED).
      limits: { students: 50, staff: 5, aiRequests: 150, liveMinutes: 250, liveConcurrent: 9, storageMb: 50 },
    },
    {
      // One share of PLATFORM_CAPACITY / HOSTED_INSTITUTIONS; the same
      // ~$0.59 per student per month as the former 250-student plan at $149.
      // liveConcurrent 18 = two full live walls; with their two teachers,
      // five institutions at once make exactly LiveKit's 100 connections.
      id: 'institution', highlight: true, priceMonthly: 89, priceYearly: 890,
      limits: { students: 150, staff: 15, aiRequests: 1_000, liveMinutes: 750, liveConcurrent: 18, storageMb: 150 },
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
