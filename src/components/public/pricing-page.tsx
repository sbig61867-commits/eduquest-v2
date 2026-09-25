'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import { pricing, pricingText, type BillingPeriod, type PricingPlan } from '@/lib/pricing/plans'
import { useTranslations } from 'next-intl'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'

// Page chrome lives in src/messages/<locale>/public.json; the plans, prices
// and plan copy stay in src/lib/pricing/plans.ts, the one file edited to change prices.
type PricingCopy = typeof enPublic.pricingPage

function priceOf(plan: PricingPlan, period: BillingPeriod) {
  return period === 'yearly' ? plan.priceYearly : plan.priceMonthly
}

export function PricingPage() {
  const [lang, setLang] = useLang()
  const [period, setPeriod] = useState<BillingPeriod>('monthly')
  const t = useTranslations('public').raw('pricingPage') as PricingCopy
  const copy = pricingText(lang)
  const currency = copy.currency

  // Only worth showing the switch when a plan actually charges a price.
  const showToggle = pricing.showBillingToggle && pricing.plans.some(p => p.priceMonthly && p.priceYearly)

  return (
    <div className="min-h-screen bg-slate-950">
      <PublicNav lang={lang} setLang={setLang} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-white text-center">{t.title}</h1>
        <p className="text-slate-400 text-center max-w-2xl mx-auto mt-3">{t.desc}</p>
        <p className="text-slate-500 text-xs text-center mt-2">{copy.lastUpdated}</p>

        {showToggle && (
          <div className="flex items-center justify-center mt-8">
            <div className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
              {(['monthly', 'yearly'] as BillingPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  aria-pressed={period === p}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    period === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p === 'monthly' ? t.monthly : t.yearly}
                </button>
              ))}
            </div>
            <span className="ms-3 text-emerald-400 text-xs font-medium">{t.save}</span>
          </div>
        )}

        {/* Plans */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-10 items-start">
          {pricing.plans.map(plan => {
            const p = copy.plans[plan.id]
            const amount = priceOf(plan, period)
            return (
              <div
                key={plan.id}
                className={`relative bg-slate-900 border rounded-2xl p-6 sm:p-7 transition-colors ${
                  plan.highlight ? 'border-blue-500/50 lg:-mt-2 lg:pb-9' : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {p.badge && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-4 ${
                    plan.highlight ? 'bg-blue-600 text-white' : 'bg-emerald-500/10 text-emerald-400'
                  }`}>
                    {p.badge}
                  </span>
                )}

                <h2 className="text-white font-bold text-xl">{p.name}</h2>
                <p className="text-slate-400 text-sm mt-1.5 leading-relaxed min-h-[2.5rem]">{p.tagline}</p>

                <div className="flex items-baseline gap-2 mt-5 mb-6" dir="ltr">
                  {amount === null ? (
                    <span className="text-2xl font-bold text-white">{t.onRequest}</span>
                  ) : amount === 0 ? (
                    <span className="text-3xl font-bold text-white">{t.free}</span>
                  ) : (
                    <>
                      <span className="text-4xl font-bold text-white">{currency}{amount}</span>
                      <span className="text-slate-500 text-sm">{period === 'yearly' ? t.perYear : t.perMonth}</span>
                    </>
                  )}
                </div>

                <Link
                  href={localizedPath(lang, '/contact')}
                  className={`block text-center px-5 py-3 rounded-xl font-semibold text-sm transition-colors ${
                    plan.highlight
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-white'
                  }`}
                >
                  {p.cta}
                </Link>

                <ul className="space-y-2.5 mt-6">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-slate-300 text-sm leading-relaxed">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>

        {/* Included in every plan */}
        <section className="mt-14">
          <h2 className="text-xl font-bold text-white text-center mb-6">{t.includedTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {copy.includedInAll.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5 bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-300 text-sm leading-relaxed">
                {item}
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto mt-16">
          <h2 className="text-2xl font-bold text-white text-center mb-8">{t.faqTitle}</h2>
          <div className="space-y-3">
            {copy.faqs.map((f, i) => (
              <details key={i} className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <summary className="p-5 cursor-pointer list-none text-white font-medium hover:bg-slate-800/50 transition-colors [&::-webkit-details-marker]:hidden">
                  {f.q}
                </summary>
                <p className="px-5 pb-5 -mt-1 text-slate-400 text-sm leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mt-16">
          <div className="bg-gradient-to-br from-blue-600/20 to-slate-900 border border-blue-500/20 rounded-2xl p-10 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t.ctaTitle}</h2>
            <p className="text-slate-300 mb-8 max-w-xl mx-auto">{t.ctaDesc}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href={localizedPath(lang, '/contact')}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
                {t.ctaButton}
              </Link>
              <Link href="/demo"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors">
                {t.ctaDemo}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter lang={lang} />
    </div>
  )
}
