'use client'

import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import { useTranslations } from 'next-intl'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'
import { FAQ_SECTION } from './anchors'

// Copy lives in src/messages/<locale>/public.json. Read with t.raw(): it is
// structured (lists of cards, FAQs) and static, so there is nothing to format.
type LandingCopy = typeof enPublic.landing

// The public pages carry no icons by design: text only, plain punctuation
// (no dashes or commas in the copy, see src/messages/<locale>/public.json).

// Fake weekly-activity bars for the hero dashboard mockup (pure CSS, no images)
const CHART_BARS = [45, 70, 55, 90, 65, 100, 80]

export function Landing() {
  const [lang, setLang] = useLang()
  const tp = useTranslations('public.landing')
  const t = useTranslations('public').raw('landing') as LandingCopy

  return (
    <div className="min-h-screen bg-slate-950">
      <PublicNav lang={lang} setLang={setLang} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.18),transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-6 text-center">
          <span className="inline-block px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-5">
            {t.heroBadge}
          </span>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold leading-tight max-w-3xl mx-auto bg-gradient-to-b from-white via-white to-slate-400 bg-clip-text text-transparent">
            {t.heroTitle}
          </h1>
          <p className="text-slate-400 text-base sm:text-lg mt-4 sm:mt-6 max-w-2xl mx-auto leading-relaxed">
            {t.heroDesc}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-7">
            <Link href={localizedPath(lang, '/contact')}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25">
              {t.heroCta}
            </Link>
            <Link href="/login"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl border border-slate-700 hover:border-slate-500 text-slate-200 font-semibold transition-colors text-center">
              {t.heroLogin}
            </Link>
            <Link href="/demo"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl border border-slate-700 hover:border-slate-500 text-slate-200 font-semibold transition-colors text-center">
              {t.demoCta}
            </Link>
          </div>

          {/* Dashboard mockup — pure CSS preview of the product */}
          <div className="relative max-w-3xl mx-auto mt-10 sm:mt-14 text-start">
            <div className="absolute -inset-4 bg-blue-600/10 blur-2xl rounded-3xl" />
            <div className="relative bg-slate-900/90 backdrop-blur border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
              {/* window bar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
                <span className="text-slate-500 text-xs font-medium ms-2">{t.mock.title}</span>
              </div>
              <div className="p-4 sm:p-5">
                {/* stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                  {t.mock.stats.map((s, i) => (
                    <div key={i} className="bg-slate-800/70 border border-slate-700/50 rounded-xl p-3">
                      <p className="text-slate-400 text-[11px] mb-1.5">{s.label}</p>
                      <p className="text-white text-lg font-bold">{s.value}</p>
                    </div>
                  ))}
                </div>
                {/* activity bars */}
                <div className="mt-3 bg-slate-800/70 border border-slate-700/50 rounded-xl p-3">
                  <p className="text-slate-400 text-[11px] mb-2">{t.mock.chartLabel}</p>
                  <div className="flex items-end gap-1.5 sm:gap-2 h-16">
                    {CHART_BARS.map((h, i) => (
                      <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-blue-600/40 to-blue-500" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Problem */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.problemTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {t.problems.map((p, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-slate-300 text-sm leading-relaxed">{p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats strip */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.statsTitle}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {t.stats.map((s, i) => (
            <div key={i} className="bg-gradient-to-b from-slate-900 to-slate-900/50 border border-slate-800 rounded-xl p-5 sm:p-6 text-center hover:border-blue-500/40 transition-colors">
              <p className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-b from-blue-300 to-blue-500 bg-clip-text text-transparent">{s.value}</p>
              <p className="text-white text-sm font-semibold mt-2">{s.label}</p>
              <p className="text-slate-500 text-xs mt-1 leading-relaxed">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Solution teaser */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.teaserTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {t.teaser.map((f, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition-colors">
              <h3 className="text-white font-semibold mb-2">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <Link href={localizedPath(lang, '/features')}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-700 hover:border-blue-500 text-slate-200 hover:text-white font-medium transition-colors">
            {t.allFeatures}
          </Link>
        </div>
      </section>

      {/* Live proctoring highlight */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="relative overflow-hidden bg-gradient-to-br from-red-600/10 via-slate-900 to-slate-900 border border-red-500/20 rounded-2xl p-6 sm:p-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold mb-4">
                {t.liveBadge}
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t.liveTitle}</h2>
              <p className="text-slate-300 leading-relaxed mb-5">{t.liveDesc}</p>
              <ul className="space-y-2.5">
                {t.livePoints.map((p, i) => (
                  <li key={i} className="text-slate-200 text-sm">{p}</li>
                ))}
              </ul>
            </div>
            {/* Mini live-wall mockup (pure CSS) */}
            <div className="grid grid-cols-2 gap-2.5">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`relative aspect-video rounded-lg bg-slate-800 border-2 overflow-hidden ${i === 1 ? 'border-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.25)]' : 'border-slate-700'}`}>
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-700/40 to-slate-900" />
                  {i === 1 && (
                    <span className="absolute top-1.5 end-1.5 flex items-center gap-1 bg-emerald-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {t.speaking}
                    </span>
                  )}
                  <span className="absolute bottom-1 start-1.5 text-white/80 text-[10px]">{tp('studentN', { n: i + 1 })}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.stepsTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {t.steps.map((s, i) => (
            <div key={i} className="relative bg-slate-900 border border-slate-800 rounded-xl p-6">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-blue-600 text-white font-bold mb-4">{i + 1}</span>
              <h3 className="text-white font-semibold mb-1.5">{s.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust / why us */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.trustTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {t.trust.map((item, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-emerald-500/30 transition-colors">
              <h3 className="text-white font-semibold mb-1.5">{item.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id={FAQ_SECTION} className="scroll-mt-24 max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.faqTitle}</h2>
        <div className="space-y-3">
          {t.faqs.map((f, i) => (
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
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 to-slate-900 border border-blue-500/20 rounded-2xl p-10 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t.ctaTitle}</h2>
          <p className="text-slate-300 mb-8 max-w-xl mx-auto">{t.ctaDesc}</p>
          <Link href={localizedPath(lang, '/contact')}
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
            {t.ctaButton}
          </Link>
        </div>
      </section>

      <PublicFooter lang={lang} />
    </div>
  )
}
