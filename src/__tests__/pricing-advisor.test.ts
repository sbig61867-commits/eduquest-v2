import { describe, expect, it } from 'vitest'
import { PLATFORM_CAPACITY, pricing, recommendPlan, type PlanId } from '@/lib/pricing/plans'
import { pricingText as ar } from '@/content/pricing/ar'
import { pricingText as en } from '@/content/pricing/en'

const plan = (id: PlanId) => pricing.plans.find(p => p.id === id)!

describe('pricing plan advisor', () => {
  it('suggests the free trial for a small single unit', () => {
    expect(recommendPlan(40, false)).toEqual({ id: 'pilot', reason: 'pilot' })
    expect(recommendPlan(50, false)).toEqual({ id: 'pilot', reason: 'pilot' })
  })

  it('suggests the institution plan up to its ceiling', () => {
    expect(recommendPlan(51, false)).toEqual({ id: 'institution', reason: 'institution' })
    expect(recommendPlan(250, false)).toEqual({ id: 'institution', reason: 'institution' })
  })

  it('suggests the full institution plan beyond every ceiling', () => {
    expect(recommendPlan(251, false)).toEqual({ id: 'university', reason: 'scale' })
  })

  it('suggests the full institution plan for several faculties at any size', () => {
    expect(recommendPlan(20, true)).toEqual({ id: 'university', reason: 'structure' })
  })
})

describe('plan limits against platform capacity', () => {
  // The mix the current infrastructure is sized for (see PLATFORM_CAPACITY):
  // two paying institutions and four trials running at the same time.
  const mix: [PlanId, number][] = [['institution', 2], ['pilot', 4]]
  const total = (key: keyof typeof PLATFORM_CAPACITY) =>
    mix.reduce((sum, [id, n]) => sum + (plan(id).limits[key] ?? 0) * n, 0)

  for (const key of Object.keys(PLATFORM_CAPACITY) as (keyof typeof PLATFORM_CAPACITY)[]) {
    it(`${key}: the sized mix stays within capacity`, () => {
      expect(total(key)).toBeLessThanOrEqual(PLATFORM_CAPACITY[key])
    })
  }

  it('no fixed plan alone takes more than a third of any capacity', () => {
    for (const p of pricing.plans) {
      for (const key of Object.keys(PLATFORM_CAPACITY) as (keyof typeof PLATFORM_CAPACITY)[]) {
        const v = p.limits[key]
        if (v !== null) expect(v, `${p.id}.${key}`).toBeLessThanOrEqual(PLATFORM_CAPACITY[key] / 3)
      }
    }
  })
})

describe('plan wording repeats the configured numbers', () => {
  // The card bullets are prose, so they carry the numbers too; they must never
  // drift from the limits the page's table (and the enforcement) use.
  for (const [locale, text] of [['ar', ar], ['en', en]] as const) {
    for (const id of ['pilot', 'institution'] as const) {
      it(`${locale}.${id}`, () => {
        const bullets = text.plans[id].features.join(' ')
        const l = plan(id).limits
        for (const n of [l.students, l.staff, l.aiRequests, l.liveMinutes]) {
          expect(bullets, `${locale}.${id} should mention ${n}`).toContain(String(n))
        }
      })
    }
  }
})
