'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'
import { CheckDot, CtaBand, PANEL, PageHero, SectionHead, WRAP } from './ui'

// /security: the trust centre. A threat explorer that lights up the layers
// enforcing each safeguard, the four protection layers, a role × data access
// matrix, what is and is not kept, and how the safeguards are verified.
// Every statement mirrors something the codebase actually enforces (see
// CLAUDE.md: RLS, server grading/timing, invitation gate, on-device proctoring).
// Copy: src/messages/<locale>/public.json → securityPage.
type SecurityCopy = typeof enPublic.securityPage
type AccessTone = 'full' | 'scoped' | 'none'

const ACCESS_DOT: Record<AccessTone, string> = {
  full: 'bg-emerald-400',
  scoped: 'bg-amber-400',
  none: 'bg-slate-600',
}

function CrossDot() {
  return (
    <span aria-hidden="true" className="relative mt-0.5 flex items-center justify-center w-5 h-5 rounded-full border border-red-400/50 shrink-0">
      <span className="absolute w-2.5 h-0.5 rounded bg-red-400 rotate-45" />
      <span className="absolute w-2.5 h-0.5 rounded bg-red-400 -rotate-45" />
    </span>
  )
}

function Explorer({ copy }: { copy: SecurityCopy['explorer'] }) {
  const [active, setActive] = useState(0)
  const threat = copy.threats[active]
  const lit = new Set(threat.layers)

  return (
    <>
      <SectionHead eyebrow={copy.eyebrow} title={copy.title} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-6">
        <div>
          <p className="text-slate-500 text-xs font-semibold mb-3">{copy.threatsLabel}</p>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {copy.threats.map((th, i) => (
              <li key={th.title}>
                <button
                  type="button"
                  aria-pressed={i === active}
                  onClick={() => setActive(i)}
                  className={`w-full flex items-center justify-between gap-3 text-start rounded-2xl border px-5 py-3.5 transition-colors ${
                    i === active ? 'border-red-400/40 bg-red-500/10' : 'border-slate-800 hover:border-slate-600 hover:bg-slate-900/60'
                  }`}
                >
                  <span className={`font-medium ${i === active ? 'text-white' : 'text-slate-300'}`}>{th.title}</span>
                  <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${i === active ? 'bg-red-400' : 'bg-slate-700'}`} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div aria-hidden="true" className="absolute -inset-6 bg-emerald-500/10 blur-3xl rounded-[2rem]" />
          <div className="relative rounded-3xl border border-slate-700/60 bg-slate-900/90 p-6 sm:p-8 shadow-2xl">
            <p className="text-slate-500 text-xs font-semibold mb-4">{copy.layersLabel}</p>
            {/* Layer stack: browser on top, database at the bottom. */}
            <ol className="space-y-2.5" aria-live="polite">
              {copy.layers.map((layer, i) => {
                const on = lit.has(i)
                return (
                  <li
                    key={layer}
                    className={`relative flex items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 transition-all duration-300 motion-reduce:transition-none ${
                      on
                        ? 'border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-emerald-400)_15%,transparent)]'
                        : 'border-slate-800 bg-slate-950/50'
                    }`}
                    style={{ marginInline: `${i * 10}px` }}
                  >
                    <span className={`text-sm font-medium ${on ? 'text-white' : 'text-slate-500'}`}>{layer}</span>
                    <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${on ? 'bg-emerald-400 motion-safe:animate-pulse' : 'bg-slate-700'}`} />
                  </li>
                )
              })}
            </ol>
            <div key={active} className="eq-menu-in mt-7 rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
              <p className="text-emerald-300 text-xs font-semibold">{copy.safeguardLabel}</p>
              <p className="text-white font-semibold text-lg mt-2">{threat.title}</p>
              <p className="text-slate-300 mt-2 leading-relaxed">{threat.safeguard}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export function SecurityPage() {
  const [lang, setLang] = useLang()
  const t = useTranslations('public').raw('securityPage') as SecurityCopy

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />
      <PageHero eyebrow={t.hero.eyebrow} title={t.hero.title} desc={t.hero.desc} />

      <section className={`${WRAP} pb-16 sm:pb-24`}>
        <Explorer copy={t.explorer} />
      </section>

      {/* Protection layers */}
      <section className="border-y border-slate-800/80 bg-slate-900/30">
        <div className={`${WRAP} py-16 sm:py-24`}>
          <SectionHead eyebrow={t.layers.eyebrow} title={t.layers.title} center />
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {t.layers.items.map((l, i) => (
              <li key={l.title} className={`${PANEL} relative p-6`}>
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600/15 border border-blue-500/30 text-blue-300 font-bold">{i + 1}</span>
                <h3 className="text-white font-semibold text-lg mt-5">{l.title}</h3>
                <p className="text-slate-400 text-sm mt-2 leading-relaxed">{l.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Access matrix */}
      <section className={`${WRAP} py-16 sm:py-24`}>
        <SectionHead eyebrow={t.access.eyebrow} title={t.access.title} desc={t.access.desc} />
        <div className={`${PANEL} overflow-x-auto`}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th scope="col" className="text-start text-slate-500 font-semibold px-6 py-4">{t.access.dataLabel}</th>
                {t.access.columns.map(c => (
                  <th key={c} scope="col" className="text-start text-white font-semibold px-6 py-4">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {t.access.rows.map(r => (
                <tr key={r.label}>
                  <th scope="row" className="text-start text-slate-200 font-medium px-6 py-4 whitespace-nowrap">{r.label}</th>
                  {r.cells.map((cell, i) => (
                    <td key={i} className="px-6 py-4 text-slate-400">
                      <span className="flex items-start gap-2.5">
                        <span aria-hidden="true" className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${ACCESS_DOT[r.tones[i] as AccessTone]}`} />
                        {cell}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-4 flex flex-wrap gap-5 text-xs text-slate-500">
          {(Object.keys(ACCESS_DOT) as AccessTone[]).map(k => (
            <li key={k} className="flex items-center gap-2">
              <span aria-hidden="true" className={`w-2 h-2 rounded-full ${ACCESS_DOT[k]}`} />
              {t.access.legend[k]}
            </li>
          ))}
        </ul>
      </section>

      {/* What is and is not kept */}
      <section className={`${WRAP} py-16 sm:py-24`}>
        <SectionHead eyebrow={t.data.eyebrow} title={t.data.title} />
        <div className="grid md:grid-cols-2 gap-4">
          <article className={`${PANEL} p-7 sm:p-9`}>
            <h3 className="text-white font-semibold text-lg">{t.data.keepTitle}</h3>
            <ul className="mt-5 space-y-3.5">
              {t.data.keep.map(k => (
                <li key={k} className="flex gap-3 text-slate-300 leading-relaxed">
                  <CheckDot tone="bg-emerald-500" />
                  {k}
                </li>
              ))}
            </ul>
          </article>
          <article className={`${PANEL} p-7 sm:p-9`}>
            <h3 className="text-white font-semibold text-lg">{t.data.skipTitle}</h3>
            <ul className="mt-5 space-y-3.5">
              {t.data.skip.map(k => (
                <li key={k} className="flex gap-3 text-slate-300 leading-relaxed">
                  <CrossDot />
                  {k}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      {/* Verification practices */}
      <section className={`${WRAP} py-16 sm:py-24`}>
        <SectionHead eyebrow={t.practices.eyebrow} title={t.practices.title} center />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {t.practices.items.map(p => (
            <article key={p.title} className={`${PANEL} p-6 border-t-4 border-t-emerald-500/60`}>
              <h3 className="text-white font-semibold text-lg">{p.title}</h3>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">{p.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <CtaBand
        title={t.cta.title}
        desc={t.cta.desc}
        primary={{ label: t.cta.primary, href: localizedPath(lang, '/contact') }}
        secondary={{ label: t.cta.secondary, href: localizedPath(lang, '/privacy') }}
      />

      <PublicFooter lang={lang} />
    </div>
  )
}
