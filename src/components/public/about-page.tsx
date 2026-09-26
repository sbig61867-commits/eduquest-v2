'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'
import { CheckDot, CtaBand, PANEL, PageHero, SectionHead, WRAP } from './ui'

// /about: mission, vision and values; the founding principles (each with the
// concrete way the platform applies it); who the platform serves; how an
// institution is accompanied; and the commitments made to it.
// Copy: src/messages/<locale>/public.json → aboutPage.
type AboutCopy = typeof enPublic.aboutPage

const PILLAR_TONE = ['from-blue-600/25', 'from-sky-500/20', 'from-violet-600/20']
const COMMUNITY_TONE = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-400']

function Principles({ copy }: { copy: AboutCopy['principles'] }) {
  const [active, setActive] = useState(0)
  const item = copy.items[active]
  return (
    <>
      <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-6">
        <ol className="grid sm:grid-cols-2 lg:grid-cols-1 gap-2">
          {copy.items.map((p, i) => (
            <li key={p.title}>
              <button
                type="button"
                aria-pressed={i === active}
                onClick={() => setActive(i)}
                className={`w-full flex items-center gap-4 text-start rounded-2xl border px-5 py-4 transition-colors ${
                  i === active ? 'border-blue-500/50 bg-blue-600/10' : 'border-slate-800 hover:border-slate-600 hover:bg-slate-900/60'
                }`}
              >
                <span className={`text-sm font-bold tabular-nums ${i === active ? 'text-blue-300' : 'text-slate-600'}`}>{String(i + 1).padStart(2, '0')}</span>
                <span className={`font-semibold ${i === active ? 'text-white' : 'text-slate-300'}`}>{p.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <article key={active} className={`eq-menu-in ${PANEL} relative overflow-hidden p-7 sm:p-10`}>
          <span aria-hidden="true" className="absolute -top-6 end-4 text-[9rem] leading-none font-extrabold text-slate-800/60 select-none tabular-nums">
            {String(active + 1).padStart(2, '0')}
          </span>
          <div className="relative">
            <h3 className="text-2xl sm:text-3xl font-bold text-white">{item.title}</h3>
            <p className="mt-5 text-lg sm:text-xl text-slate-200 leading-loose border-s-4 border-blue-500/70 ps-5">{item.statement}</p>
            <p className="mt-9 text-blue-300 text-sm font-semibold">{copy.applyLabel}</p>
            <ul className="mt-4 space-y-3">
              {item.applications.map(a => (
                <li key={a} className="flex gap-3 text-slate-300 leading-relaxed">
                  <CheckDot />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>
    </>
  )
}

export function AboutPage() {
  const [lang, setLang] = useLang()
  const t = useTranslations('public').raw('aboutPage') as AboutCopy

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />
      <PageHero eyebrow={t.hero.eyebrow} title={t.hero.title} desc={t.hero.desc} />

      {/* Mission · vision · values */}
      <section className={`${WRAP} pb-16 sm:pb-20`}>
        <div className="grid md:grid-cols-3 gap-4">
          {t.pillars.map((p, i) => (
            <article key={p.label} className={`relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-b ${PILLAR_TONE[i]} to-slate-900/40 p-7 sm:p-9`}>
              <p className="text-blue-300 text-sm font-bold tracking-wide">{p.label}</p>
              <p className="text-white text-lg sm:text-xl leading-loose mt-4">{p.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-800/80 bg-slate-900/30">
        <div className={`${WRAP} py-16 sm:py-24`}>
          <Principles copy={t.principles} />
        </div>
      </section>

      {/* Community */}
      <section className={`${WRAP} py-16 sm:py-24`}>
        <SectionHead eyebrow={t.community.eyebrow} title={t.community.title} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {t.community.items.map((c, i) => (
            <article key={c.role} className={`${PANEL} overflow-hidden`}>
              <span aria-hidden="true" className={`block h-1.5 ${COMMUNITY_TONE[i]}`} />
              <div className="p-6">
                <h3 className="text-white font-semibold text-lg leading-snug">{c.role}</h3>
                <p className="text-slate-400 text-sm mt-3 leading-relaxed">{c.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Journey */}
      <section className={`${WRAP} py-16 sm:py-24`}>
        <SectionHead eyebrow={t.journey.eyebrow} title={t.journey.title} center />
        <ol className="relative grid gap-8 lg:gap-4 lg:grid-cols-5">
          <span aria-hidden="true" className="hidden lg:block absolute top-6 inset-x-[10%] h-0.5 bg-gradient-to-r from-blue-500/10 via-blue-500/50 to-blue-500/10" />
          <span aria-hidden="true" className="lg:hidden absolute top-2 bottom-2 start-6 w-0.5 bg-gradient-to-b from-blue-500/50 to-blue-500/10" />
          {t.journey.items.map((s, i) => (
            <li key={s.title} className="relative flex lg:block items-start gap-5 lg:text-center">
              <span className="relative shrink-0 lg:mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-slate-950 border-2 border-blue-500 text-blue-300 font-bold">{i + 1}</span>
              <div>
                <h3 className="text-white font-semibold lg:mt-4">{s.title}</h3>
                <p className="text-slate-400 text-sm mt-1.5 leading-relaxed lg:max-w-[15rem] lg:mx-auto">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Commitments */}
      <section className={`${WRAP} py-16 sm:py-24`}>
        <SectionHead eyebrow={t.commitments.eyebrow} title={t.commitments.title} />
        <div className="grid md:grid-cols-2 gap-4">
          {t.commitments.items.map(c => (
            <article key={c.title} className={`${PANEL} border-s-4 border-s-blue-500/70 p-7`}>
              <h3 className="text-white font-semibold text-lg">{c.title}</h3>
              <p className="text-slate-400 mt-2 leading-relaxed">{c.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <CtaBand
        title={t.cta.title}
        desc={t.cta.desc}
        primary={{ label: t.cta.primary, href: localizedPath(lang, '/contact') }}
        secondary={{ label: t.cta.secondary, href: localizedPath(lang, '/features') }}
      />

      <PublicFooter lang={lang} />
    </div>
  )
}
