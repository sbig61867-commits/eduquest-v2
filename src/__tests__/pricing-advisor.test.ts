import { describe, expect, it } from 'vitest'
import { HOSTED_INSTITUTIONS, LIMIT_KEYS, PLATFORM_CAPACITY, pricing, recommendPlan, type PlanId } from '@/lib/pricing/plans'
import { MAX_WATCHED } from '@/lib/live-channel'
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
    expect(recommendPlan(150, false)).toEqual({ id: 'institution', reason: 'institution' })
  })

  it('suggests the full institution plan beyond every ceiling', () => {
    expect(recommendPlan(151, false)).toEqual({ id: 'university', reason: 'scale' })
  })

  it('suggests the full institution plan for several faculties at any size', () => {
    expect(recommendPlan(20, true)).toEqual({ id: 'university', reason: 'structure' })
  })
})

describe('plan limits against platform capacity', () => {
  // The current infrastructure is split into HOSTED_INSTITUTIONS equal shares
  // (see PLATFORM_CAPACITY): every hosted institution on the institution plan.
  const keys = Object.keys(PLATFORM_CAPACITY) as (keyof typeof PLATFORM_CAPACITY)[]

  for (const key of keys) {
    it(`${key}: ${HOSTED_INSTITUTIONS} institutions stay within capacity`, () => {
      expect((plan('institution').limits[key] ?? 0) * HOSTED_INSTITUTIONS).toBeLessThanOrEqual(PLATFORM_CAPACITY[key])
    })
  }

  it('a trial fits inside one institution share', () => {
    for (const key of LIMIT_KEYS) {
      expect(plan('pilot').limits[key]!, key).toBeLessThanOrEqual(plan('institution').limits[key]!)
    }
  })

  it('live walls: concurrent students plus one teacher per full wall fit LiveKit\'s 100 connections', () => {
    const connections = (n: number) => n + Math.ceil(n / MAX_WATCHED)
    expect(connections(plan('institution').limits.liveConcurrent!) * HOSTED_INSTITUTIONS).toBeLessThanOrEqual(100)
  })

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
