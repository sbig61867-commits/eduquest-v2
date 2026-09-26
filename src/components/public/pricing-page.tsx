'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import {
  LIMIT_KEYS, pricing, pricingText, recommendPlan, type BillingPeriod, type PlanId, type PricingPlan,
} from '@/lib/pricing/plans'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'
import { CheckDot, CtaBand, FaqGrid, PANEL, PageHero, SectionHead, Segmented, WRAP } from './ui'

// /pricing ("الباقات"). Page chrome lives in src/messages/<locale>/public.json;
// prices, ceilings and switches in src/lib/pricing/plans.ts; plan wording in
// src/content/pricing/{ar,en}.ts. Never hardcode a number here.
type PricingCopy = typeof enPublic.pricingPage

function priceOf(plan: PricingPlan, period: BillingPeriod) {
  return period === 'yearly' ? plan.priceYearly : plan.priceMonthly
}

// ── Plan advisor scale ──────────────────────────────────────────────────────
// The slider runs 0..SCALE. Each plan owns an equal share of it, spanning the
// student counts between its neighbours' ceilings, so the small trial range
// is as easy to hit as the large ones. Ceilings come from `pricing`.
const SCALE = 1000
const MIN_STUDENTS = 10
const ceilings = pricing.plans.map(p => p.limits.students).filter((n): n is number => n !== null).sort((a, b) => a - b)
const BREAKS = [MIN_STUDENTS, ...ceilings, (ceilings[ceilings.length - 1] ?? 500) * 6]
const SEGMENT = SCALE / (BREAKS.length - 1)

function studentsAt(pos: number): number {
  const k = Math.min(BREAKS.length - 2, Math.floor(pos / SEGMENT))
  const within = (pos - k * SEGMENT) / SEGMENT
  const raw = BREAKS[k] + within * (BREAKS[k + 1] - BREAKS[k])
  const step = raw < 100 ? 5 : raw < 1000 ? 10 : 50
  return Math.max(MIN_STUDENTS, Math.round(raw / step) * step)
}

function PlanPrice({ plan, period, t, currency, big = true }: {
  plan: PricingPlan; period: BillingPeriod; t: PricingCopy; currency: string; big?: boolean
}) {
  const amount = priceOf(plan, period)
  if (amount === null) return <span className={`${big ? 'text-2xl' : 'text-xl'} font-bold text-white`}>{t.onRequest}</span>
  if (amount === 0) return <span className={`${big ? 'text-4xl' : 'text-2xl'} font-bold text-white`}>{t.free}</span>
  return (
    <span className="inline-flex items-baseline gap-2" dir="ltr">
      <span className={`${big ? 'text-5xl' : 'text-3xl'} font-extrabold text-white tracking-tight`}>{currency}{amount}</span>
      <span className="text-slate-500 text-sm">{period === 'yearly' ? t.perYear : t.perMonth}</span>
    </span>
  )
}

export function PricingPage() {
  const [lang, setLang] = useLang()
  const [period, setPeriod] = useState<BillingPeriod>('monthly')
  const [pos, setPos] = useState(SEGMENT * 1.5)
  const [multi, setMulti] = useState(0)
  const tp = useTranslations('public')
  const t = tp.raw('pricingPage') as PricingCopy
  const copy = pricingText(lang)
  const contact = localizedPath(lang, '/contact')

  // Only worth showing the switch when a plan actually charges a price.
  const showToggle = pricing.showBillingToggle && pricing.plans.some(p => p.priceMonthly && p.priceYearly)
  const students = studentsAt(pos)
  const atMax = pos >= SCALE
  const rec = recommendPlan(students, multi === 1)
  const recPlan = pricing.plans.find(p => p.id === rec.id) as PricingPlan
  const periodIndex = period === 'monthly' ? 0 : 1

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />

      <PageHero eyebrow={t.hero.eyebrow} title={t.hero.title} desc={t.hero.desc}>
        <p className="text-slate-500 text-xs mt-4">{copy.lastUpdated}</p>
        {showToggle && (
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Segmented
              options={[t.monthly, t.yearly]}
              value={periodIndex}
              onChange={i => setPeriod(i === 0 ? 'monthly' : 'yearly')}
              label={t.billingLabel}
            />
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium">{t.save}</span>
          </div>
        )}
      </PageHero>

      {/* Plans */}
      <section className={`${WRAP} pb-16 sm:pb-20`}>
        <div className="grid lg:grid-cols-3 gap-5 items-stretch">
          {pricing.plans.map(plan => {
            const p = copy.plans[plan.id]
            const recommended = plan.id === rec.id
            const card = (
              <div className={`relative h-full flex flex-col rounded-[1.4rem] p-7 sm:p-8 ${plan.highlight ? 'bg-slate-900' : `${PANEL} hover:border-slate-600 transition-colors`}`}>
                <div className="flex flex-wrap items-center gap-2 min-h-7">
                  {p.badge && (
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${plan.highlight ? 'bg-blue-600 text-on-accent' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'}`}>
                      {p.badge}
                    </span>
                  )}
                  {recommended && (
                    <span className="px-3 py-1 rounded-full text-xs font-semibold border border-amber-400/40 bg-amber-400/10 text-amber-300">{t.advisor.resultLabel}</span>
                  )}
                </div>
                <h2 className="text-white font-bold text-2xl mt-5">{p.name}</h2>
                <p className="text-slate-400 text-sm mt-2 leading-relaxed min-h-[2.75rem]">{p.tagline}</p>
                <div key={period} className="eq-menu-in mt-6 mb-7 min-h-[3.5rem] flex items-end">
                  <PlanPrice plan={plan} period={period} t={t} currency={copy.currency} />
                </div>
                <Link
                  href={contact}
                  className={`block text-center px-5 py-3 rounded-xl font-semibold text-sm transition-colors ${
                    plan.highlight ? 'bg-blue-600 hover:bg-blue-500 text-on-accent shadow-lg shadow-blue-600/25' : 'border border-slate-700 hover:border-slate-500 text-white'
                  }`}
                >
                  {p.cta}
                </Link>
                <ul className="space-y-3 mt-8 pt-7 border-t border-slate-800">
                  {p.features.map(f => (
                    <li key={f} className="flex gap-3 text-slate-300 text-sm leading-relaxed">
                      <CheckDot tone={plan.highlight ? 'bg-blue-600' : 'bg-slate-700'} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )
            return plan.highlight ? (
              <div key={plan.id} className={`relative rounded-3xl p-px bg-gradient-to-b from-blue-500 via-blue-500/30 to-slate-800 shadow-2xl shadow-blue-600/15 ${recommended ? 'ring-2 ring-amber-400/50 ring-offset-4 ring-offset-slate-950' : ''}`}>
                {card}
              </div>
            ) : (
              <div key={plan.id} className={`rounded-3xl ${recommended ? 'ring-2 ring-amber-400/50 ring-offset-4 ring-offset-slate-950' : ''}`}>{card}</div>
            )
          })}
        </div>
      </section>

      {/* Plan advisor */}
      <section className="border-y border-slate-800/80 bg-slate-900/30">
        <div className={`${WRAP} py-16 sm:py-20 grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-center`}>
          <div>
            <SectionHead eyebrow={t.advisor.eyebrow} title={t.advisor.title} desc={t.advisor.desc} />
            <div className="-mt-2 space-y-8">
              <div>
                <div className="flex items-end justify-between gap-4 mb-3">
                  <label htmlFor="advisor-students" className="text-slate-300 text-sm font-medium">{t.advisor.studentsLabel}</label>
                  <span className="text-white text-3xl font-extrabold tabular-nums" dir="ltr">{students}{atMax ? '+' : ''}</span>
                </div>
                <input
                  id="advisor-students"
                  type="range"
                  min={0}
                  max={SCALE}
                  step={1}
                  value={pos}
                  onChange={e => setPos(Number(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                {/* The plan each part of the scale belongs to. */}
                <div aria-hidden="true" className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${BREAKS.length - 1}, minmax(0, 1fr))` }}>
                  {pricing.plans.map(plan => (
                    <span key={plan.id} className={`h-1.5 rounded-full transition-colors ${plan.id === rec.id && multi === 0 ? 'bg-blue-500' : 'bg-slate-800'}`} />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-slate-300 text-sm font-medium mb-3">{t.advisor.structureLabel}</p>
                <Segmented options={t.advisor.structures} value={multi} onChange={setMulti} label={t.advisor.structureLabel} />
              </div>
            </div>
          </div>

          <div className="relative">
            <div aria-hidden="true" className="absolute -inset-6 bg-blue-600/15 blur-3xl rounded-[2rem]" />
            <div key={`${rec.id}-${rec.reason}`} className="eq-menu-in relative rounded-3xl border border-blue-500/30 bg-slate-900/90 p-7 sm:p-9 shadow-2xl">
              <p className="text-amber-300 text-xs font-semibold">{t.advisor.resultLabel}</p>
              <p className="text-white text-3xl font-bold mt-3">{copy.plans[rec.id as PlanId].name}</p>
              <div className="mt-4"><PlanPrice plan={recPlan} period={period} t={t} currency={copy.currency} big={false} /></div>
              <p className="text-slate-300 mt-5 leading-relaxed">{t.advisor.reasons[rec.reason]}</p>
              <Link href={contact} className="mt-7 inline-block px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-on-accent font-semibold text-sm transition-colors">
                {copy.plans[rec.id as PlanId].cta}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Usage limits — every number comes from src/lib/pricing/plans.ts */}
      <section className={`${WRAP} py-16 sm:py-20`}>
        <SectionHead title={copy.limits.title} desc={copy.limits.desc} center />
        <div className={`${PANEL} overflow-x-auto`}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th scope="col" className="text-start text-slate-500 font-semibold px-6 py-4">{copy.limits.limitLabel}</th>
                {pricing.plans.map(plan => (
                  <th key={plan.id} scope="col" className={`text-start font-semibold px-6 py-4 ${plan.highlight ? 'text-blue-300' : 'text-white'}`}>
                    {copy.plans[plan.id].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {LIMIT_KEYS.map(key => (
                <tr key={key}>
                  <th scope="row" className="text-start text-slate-300 font-medium px-6 py-4">{copy.limits.labels[key]}</th>
                  {pricing.plans.map(plan => {
                    const v = plan.limits[key]
                    return (
                      <td key={plan.id} className={`px-6 py-4 ${plan.highlight ? 'bg-blue-600/5' : ''}`}>
                        {v === null
                          ? <span className="text-slate-400">{copy.limits.byAgreement}</span>
                          : <span className="text-white font-semibold tabular-nums" dir="ltr">{v.toLocaleString('en')}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-5 space-y-2 text-slate-500 text-sm leading-relaxed max-w-4xl">
          {copy.limits.notes.map(n => <li key={n}>{n}</li>)}
        </ul>
      </section>

      {/* Included in every plan */}
      <section className={`${WRAP} py-16 sm:py-20`}>
        <SectionHead title={t.includedTitle} center />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {copy.includedInAll.map(item => (
            <li key={item} className={`${PANEL} flex gap-3 p-5 text-slate-300 text-sm leading-relaxed`}>
              <CheckDot tone="bg-emerald-500" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className={`${WRAP} py-16 sm:py-20`}>
        <SectionHead title={t.faqTitle} center />
        <FaqGrid items={copy.faqs} />
      </section>

      <CtaBand
        title={t.cta.title}
        desc={t.cta.desc}
        primary={{ label: t.cta.primary, href: contact }}
        secondary={{ label: t.cta.secondary, href: localizedPath(lang, '/demo') }}
      />

      <PublicFooter lang={lang} />
    </div>
  )
}
