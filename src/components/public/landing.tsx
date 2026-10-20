'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'
import { LOCALES, LOCALE_DIR } from '@/i18n/config'
import { FAQ_SECTION } from './anchors'
import { CtaBand, Eyebrow, FaqGrid, MediaSlot, PANEL, SectionHead, Segmented, WRAP } from './ui'

// Copy lives in src/messages/<locale>/public.json under `landing`, written in a
// formal academic register. Read with t.raw(): it is structured and static.
//
// The public pages carry no icons by design: text only, plain punctuation
// (see src/__tests__/public-copy-style.test.ts). Every visual is pure CSS and
// every demo is driven by the copy, so both languages get the same page.
type LandingCopy = typeof enPublic.landing
type Tone = 'high' | 'mid' | 'low'

const TONE_CLASS: Record<Tone, string> = {
  high: 'bg-red-500/15 text-red-300 border-red-500/30',
  mid: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
}

/** Delay between the stages of the lesson-studio demo. */
const STAGE_MS = 750

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function StageDot({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') return <span aria-hidden="true" className="w-3 h-3 rounded-full bg-blue-500 shrink-0" />
  if (state === 'active')
    return (
      <span aria-hidden="true" className="relative w-3 h-3 shrink-0">
        <span className="absolute inset-0 rounded-full bg-blue-400" />
      </span>
    )
  return <span aria-hidden="true" className="w-3 h-3 rounded-full border-2 border-slate-600 shrink-0" />
}

/** Hero demo: pick a source material and watch it become a structured lesson. */
function LessonStudio({ copy }: { copy: LandingCopy['studio'] }) {
  const [source, setSource] = useState(0)
  const [run, setRun] = useState(0)
  const [stage, setStage] = useState(0)
  const s = copy.sources[source]
  const total = copy.stages.length

  // Handlers reset the stage; the effect only schedules the reveal. With
  // reduced motion every stage lands at once.
  useEffect(() => {
    const step = prefersReducedMotion() ? 0 : STAGE_MS
    const timers = Array.from({ length: total }, (_, i) => window.setTimeout(() => setStage(i + 1), step * (i + 1)))
    return () => timers.forEach(window.clearTimeout)
  }, [source, run, total])

  const restart = (next: () => void) => {
    setStage(0)
    next()
  }

  const block = (visible: boolean) =>
    `transition-[opacity,transform] duration-500 motion-reduce:transition-none ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`

  return (
    <div className="relative">
      <div className="relative grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] rounded-[2rem] border border-slate-700/60 bg-slate-900/90 backdrop-blur shadow-2xl overflow-hidden">
        {/* Source picker + pipeline */}
        <div className="p-6 sm:p-7 border-b lg:border-b-0 lg:border-e border-slate-800 bg-slate-950/40">
          <p className="text-slate-500 text-xs font-semibold mb-3">{copy.sourceLabel}</p>
          <div className="space-y-2">
            {copy.sources.map((src, i) => (
              <button
                key={src.tab}
                type="button"
                aria-pressed={i === source}
                onClick={() => restart(() => setSource(i))}
                className={`w-full text-start rounded-2xl border px-4 py-3 transition-colors ${
                  i === source ? 'border-blue-500/60 bg-blue-600/10' : 'border-slate-800 hover:border-slate-600 hover:bg-slate-900'
                }`}
              >
                <span className={`block font-semibold ${i === source ? 'text-white' : 'text-slate-300'}`}>{src.tab}</span>
                <span className="block text-slate-500 text-xs mt-1 leading-relaxed">{src.file}</span>
              </button>
            ))}
          </div>

          <ol className="mt-7 space-y-3" aria-live="polite">
            {copy.stages.map((label, i) => (
              <li key={label} className="flex items-center gap-3 text-sm">
                <StageDot state={stage > i ? 'done' : stage === i ? 'active' : 'pending'} />
                <span className={stage > i ? 'text-slate-200' : stage === i ? 'text-blue-300' : 'text-slate-500'}>{label}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => restart(() => setRun(r => r + 1))}
            className="mt-6 px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-sm hover:text-white hover:border-slate-500 transition-colors"
          >
            {copy.replay}
          </button>
        </div>

        {/* Generated lesson */}
        <div className="p-6 sm:p-8 lg:p-10">
          <div className="h-1 rounded-full bg-slate-800 overflow-hidden mb-7">
            <div className="h-full bg-gradient-to-r from-blue-600 to-sky-400 transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${(stage / total) * 100}%` }} />
          </div>
          <h3 className={`text-2xl sm:text-3xl font-bold text-white ${block(stage >= 1)}`}>{s.lesson}</h3>
          <div className="mt-7 grid md:grid-cols-2 gap-5">
            <section className={`rounded-2xl border border-slate-800 bg-slate-950/50 p-5 ${block(stage >= 1)}`}>
              <h4 className="text-blue-300 text-sm font-semibold mb-3">{copy.objectivesLabel}</h4>
              <ul className="space-y-2.5">
                {s.objectives.map(o => (
                  <li key={o} className="flex gap-2.5 text-slate-300 text-sm leading-relaxed">
                    <span aria-hidden="true" className="mt-2 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    {o}
                  </li>
                ))}
              </ul>
            </section>
            <div className="space-y-5">
              <section className={`rounded-2xl border border-slate-800 bg-slate-950/50 p-5 ${block(stage >= 2)}`}>
                <h4 className="text-blue-300 text-sm font-semibold mb-3">{copy.termsLabel}</h4>
                <ul className="flex flex-wrap gap-2">
                  {s.terms.map(term => (
                    <li key={term} className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-200 text-sm">{term}</li>
                  ))}
                </ul>
              </section>
              <section className={`rounded-2xl border border-slate-800 bg-slate-950/50 p-5 ${block(stage >= 3)}`}>
                <h4 className="text-blue-300 text-sm font-semibold mb-3">{copy.questionsLabel}</h4>
                <ol className="space-y-2.5 list-decimal ps-5 marker:text-slate-500">
                  {s.questions.map(q => (
                    <li key={q} className="text-slate-300 text-sm leading-relaxed ps-1">{q}</li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
          <p className={`mt-6 text-slate-400 text-sm border-s-2 border-emerald-500/60 ps-3 ${block(stage >= total)}`}>{copy.review}</p>
        </div>
      </div>
    </div>
  )
}

/** Institution type → the admin side menu relabels itself. */
function Institutions({ copy }: { copy: LandingCopy['institutions'] }) {
  const [active, setActive] = useState(0)
  const item = copy.items[active]
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-10 lg:gap-16 items-center">
      <div>
        <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
        <div role="group" aria-label={copy.title} className="-mt-2 flex flex-wrap gap-2">
          {copy.items.map((it, i) => (
            <button
              key={it.name}
              type="button"
              aria-pressed={i === active}
              onClick={() => setActive(i)}
              className={`px-5 py-2.5 rounded-full border text-sm font-medium transition-colors ${
                i === active ? 'bg-blue-600 border-blue-600 text-on-accent' : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
              }`}
            >
              {it.name}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-3xl border border-slate-700/60 bg-slate-900/90 overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-800">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
          <span className="text-slate-500 text-xs ms-2">{copy.previewLabel}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] min-h-[19rem]">
          <ul key={active} className="eq-menu-in border-e border-slate-800 p-3 space-y-1 bg-slate-950/50">
            {item.menu.map((m, i) => (
              <li key={m} className={`px-3 py-2.5 rounded-xl text-sm ${i === 0 ? 'bg-blue-600/15 text-blue-200 font-medium' : 'text-slate-400'}`}>{m}</li>
            ))}
          </ul>
          <div key={`main-${active}`} className="eq-menu-in p-5 sm:p-6">
            <p className="text-white text-lg font-semibold">{item.menu[0]}</p>
            <div aria-hidden="true" className="mt-5 space-y-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <span className="w-8 h-8 rounded-lg bg-slate-800" />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-2 rounded bg-slate-700" style={{ width: `${70 - i * 12}%` }} />
                    <span className="block h-1.5 rounded bg-slate-800" style={{ width: `${45 - i * 6}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A school day as a master–detail list. */
function Journey({ copy }: { copy: LandingCopy['journey'] }) {
  const [active, setActive] = useState(0)
  const item = copy.items[active]
  return (
    <>
      <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
        <ol className="space-y-2">
          {copy.items.map((it, i) => (
            <li key={it.time}>
              <button
                type="button"
                aria-pressed={i === active}
                onClick={() => setActive(i)}
                className={`w-full grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-4 text-start rounded-2xl border px-5 py-4 transition-colors ${
                  i === active ? 'border-blue-500/50 bg-blue-600/10' : 'border-slate-800 hover:border-slate-600 hover:bg-slate-900/60'
                }`}
              >
                <span className={`text-sm ${i === active ? 'text-blue-300' : 'text-slate-500'}`}>{it.time}</span>
                <span className={`font-semibold ${i === active ? 'text-white' : 'text-slate-300'}`}>{it.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <article key={active} className={`eq-menu-in ${PANEL} p-7 sm:p-10 flex flex-col`}>
          <p className="text-blue-300 font-semibold">{item.time}</p>
          <h3 className="text-2xl sm:text-3xl font-bold text-white mt-3">{item.title}</h3>
          <p className="text-slate-300 text-base sm:text-lg leading-loose mt-5">{item.desc}</p>
          <div className="mt-auto pt-8 flex items-center gap-3 text-sm">
            <span className="text-slate-500">{copy.roleLabel}</span>
            <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-200">{item.role}</span>
          </div>
          <div aria-hidden="true" className="mt-6 flex gap-1.5">
            {copy.items.map((_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= active ? 'bg-blue-500' : 'bg-slate-800'}`} />
            ))}
          </div>
        </article>
      </div>
    </>
  )
}

/** Capability cards filtered by area. */
function Capabilities({ copy }: { copy: LandingCopy['capabilities'] }) {
  const [filter, setFilter] = useState<string | null>(null)
  const labelOf = (key: string) => copy.categories.find(c => c.key === key)?.label ?? ''
  const cards = filter ? copy.cards.filter(c => c.cat === filter) : copy.cards
  const chip = (on: boolean) =>
    `px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
      on ? 'bg-fg text-canvas border-fg' : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
    }`
  return (
    <>
      <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
      <div role="group" aria-label={copy.title} className="flex flex-wrap gap-2 mb-8">
        <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className={chip(filter === null)}>{copy.all}</button>
        {copy.categories.map(c => (
          <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)} className={chip(filter === c.key)}>{c.label}</button>
        ))}
      </div>
      <div key={filter ?? 'all'} className="eq-menu-in grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map(card => (
          <article key={card.title} className={`${PANEL} p-6 hover:border-slate-600 hover:bg-slate-900 transition-colors`}>
            <span className="text-blue-400 text-xs font-semibold">{labelOf(card.cat)}</span>
            <h3 className="text-white font-semibold text-lg mt-2 leading-snug">{card.title}</h3>
            <p className="text-slate-400 text-sm mt-2.5 leading-relaxed">{card.desc}</p>
          </article>
        ))}
      </div>
    </>
  )
}

/** Device vs instructor: what stays local and what is reported. */
function Privacy({ copy }: { copy: LandingCopy['privacy'] }) {
  const [view, setView] = useState(0)
  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
      <div>
        <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
        <div className="-mt-2">
          <Segmented options={[copy.deviceTab, copy.teacherTab]} value={view} onChange={setView} label={copy.title} />
        </div>
      </div>
      <div className="relative">
        <div key={view} className="eq-menu-in relative rounded-3xl border border-slate-700/60 bg-slate-900/90 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
            <p className="text-white font-semibold">{view === 0 ? copy.deviceTab : copy.teacherTab}</p>
            <span aria-hidden="true" className={`w-2 h-2 rounded-full ${view === 0 ? 'bg-emerald-400' : 'bg-blue-400'}`} />
          </div>
          {view === 0 ? (
            <ul className="divide-y divide-slate-800">
              {copy.device.map(d => (
                <li key={d} className="flex items-center justify-between gap-4 px-6 py-4">
                  <span className="text-slate-200 text-sm">{d}</span>
                  <span className="shrink-0 px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs">{copy.deviceBadge}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-slate-800">
              {copy.events.map(ev => (
                <li key={ev.time} className="flex items-center gap-4 px-6 py-4">
                  <span className="text-slate-500 text-xs w-24 shrink-0">{ev.time}</span>
                  <span className="flex-1 text-slate-200 text-sm">{ev.label}</span>
                  <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${TONE_CLASS[ev.tone as Tone]}`}>{ev.level}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="px-6 py-4 bg-slate-950/60 text-slate-300 text-sm leading-relaxed border-t border-slate-800">
            {view === 0 ? copy.deviceNote : copy.teacherNote}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Appeal procedure as a clickable stepper. */
function Fairness({ copy }: { copy: LandingCopy['fairness'] }) {
  const [active, setActive] = useState(0)
  const n = copy.steps.length
  return (
    <div className="rounded-[2rem] border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-7 sm:p-12">
      <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} center />
      <div className="relative">
        <div aria-hidden="true" className="hidden lg:block absolute top-6 h-0.5 bg-slate-800" style={{ insetInline: `${50 / n}%` }}>
          <div className="h-full bg-blue-500 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(active / (n - 1)) * 100}%` }} />
        </div>
        <ol className="relative grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-4">
          {copy.steps.map((s, i) => (
            <li key={s.title}>
              <button type="button" aria-pressed={i === active} onClick={() => setActive(i)} className="group w-full text-center">
                <span
                  className={`relative mx-auto flex items-center justify-center w-12 h-12 rounded-full border-2 font-bold transition-colors ${
                    i <= active ? 'bg-blue-600 border-blue-500 text-on-accent' : 'bg-slate-950 border-slate-700 text-slate-400 group-hover:border-slate-500'
                  }`}
                >
                  {i + 1}
                </span>
                <span className={`block font-semibold mt-4 ${i === active ? 'text-white' : 'text-slate-300'}`}>{s.title}</span>
                <span className={`block text-sm mt-1.5 leading-relaxed max-w-[17rem] mx-auto transition-colors ${i === active ? 'text-slate-300' : 'text-slate-500'}`}>{s.desc}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/** Toggle centre-manager permissions and watch the menu follow. */
function CentrePermissions({ copy }: { copy: LandingCopy['centre'] }) {
  const [on, setOn] = useState(() => copy.caps.map(c => c.on))
  const granted = copy.caps.filter((_, i) => on[i])
  return (
    <div className={`${PANEL} p-7 sm:p-9`}>
      <Eyebrow>{copy.eyebrow}</Eyebrow>
      <h2 className="text-2xl sm:text-3xl font-bold text-white leading-snug">{copy.title}</h2>
      <p className="text-slate-400 mt-4 leading-relaxed">{copy.desc}</p>
      <div className="mt-7 grid sm:grid-cols-2 gap-5">
        <div>
          <p className="text-slate-500 text-xs font-semibold mb-3">{copy.capsLabel}</p>
          <ul className="space-y-2">
            {copy.caps.map((c, i) => (
              <li key={c.label}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on[i]}
                  onClick={() => setOn(prev => prev.map((v, j) => (j === i ? !v : v)))}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-2.5 text-sm text-start hover:border-slate-600 transition-colors"
                >
                  <span className={on[i] ? 'text-white' : 'text-slate-400'}>{c.label}</span>
                  <span aria-hidden="true" className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${on[i] ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-on-accent transition-[inset-inline-start] duration-200 ${on[i] ? 'start-[1.125rem]' : 'start-0.5'}`} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/70 p-3">
          <p className="text-slate-500 text-xs font-semibold px-2 pt-1 pb-3">{copy.previewLabel}</p>
          <ul className="space-y-1" aria-live="polite">
            <li className="px-3 py-2 rounded-lg bg-blue-600/15 text-blue-200 text-sm font-medium">{copy.base}</li>
            {granted.map(c => (
              <li key={c.menu} className="eq-menu-in px-3 py-2 rounded-lg text-slate-300 text-sm">{c.menu}</li>
            ))}
          </ul>
          {granted.length === 0 && <p className="px-3 py-3 text-slate-500 text-sm">{copy.empty}</p>}
        </div>
      </div>
      <p className="mt-6 text-slate-400 text-sm border-s-2 border-blue-500/60 ps-3">{copy.note}</p>
    </div>
  )
}

/** Rule-based finding vs on-demand elaborated wording. */
function Insights({ copy }: { copy: LandingCopy['insights'] }) {
  const [mode, setMode] = useState(0)
  return (
    <div className={`${PANEL} p-7 sm:p-9 flex flex-col`}>
      <Eyebrow>{copy.eyebrow}</Eyebrow>
      <h2 className="text-2xl sm:text-3xl font-bold text-white leading-snug">{copy.title}</h2>
      <p className="text-slate-400 mt-4 leading-relaxed">{copy.desc}</p>
      <div className="mt-7 rounded-2xl border border-slate-700/60 bg-slate-950/70 p-5 flex-1">
        <p className="text-white font-semibold">{copy.course}</p>
        <dl className="mt-4 grid gap-2.5 text-sm">
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-3">
            <dt className="text-emerald-300 text-xs font-semibold">{copy.strengthLabel}</dt>
            <dd className="text-slate-300 mt-1">{copy.strength}</dd>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-3">
            <dt className="text-amber-300 text-xs font-semibold">{copy.weaknessLabel}</dt>
            <dd className="text-slate-300 mt-1">{copy.weakness}</dd>
          </div>
          <div className="rounded-xl bg-slate-900 border border-blue-500/30 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <dt className="text-blue-300 text-xs font-semibold">{copy.suggestionLabel}</dt>
              <Segmented options={[copy.ruleTab, copy.aiTab]} value={mode} onChange={setMode} label={copy.suggestionLabel} />
            </div>
            <dd key={mode} className="eq-menu-in text-slate-300 mt-3 leading-relaxed">{mode === 0 ? copy.rule : copy.ai}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export function Landing() {
  const [lang, setLang] = useLang()
  const t = useTranslations('public').raw('landing') as LandingCopy
  const contact = localizedPath(lang, '/contact')

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />

      {/* Hero + lesson studio */}
      <section className="relative">
        <div className={`relative ${WRAP} pt-14 sm:pt-20 pb-16 sm:pb-20`}>
          <div className="grid gap-10 lg:gap-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center">
          <div className="text-start">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/25 text-blue-300 text-sm font-medium">
              {t.hero.badge}
            </span>
            <h1 className="mt-7 font-extrabold text-white leading-tight">
              <span className="block text-4xl sm:text-5xl lg:text-6xl">{t.hero.title}</span>
              <span className="block mt-4 text-xl sm:text-3xl lg:text-4xl font-bold text-blue-300 leading-snug">
                {t.hero.titleAccent}
              </span>
            </h1>
            <p className="text-slate-400 text-base sm:text-lg mt-7 max-w-2xl leading-loose">{t.hero.desc}</p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-9">
              <Link href={contact} className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-on-accent font-semibold transition-colors text-center">
                {t.hero.primary}
              </Link>
              <Link href={localizedPath(lang, '/demo')} className="w-full sm:w-auto px-8 py-3.5 rounded-xl border border-slate-700 hover:border-slate-500 hover:bg-slate-900 text-slate-200 font-semibold transition-colors text-center">
                {t.hero.demo}
              </Link>
            </div>
            <p className="text-slate-500 text-sm mt-5">{t.hero.note}</p>
          </div>
          {/* Reserved for a hero photograph or video (none yet). */}
          <MediaSlot />
          </div>

          <div className="mt-16 sm:mt-20">
            <div className="text-center mb-8">
              <Eyebrow>{t.studio.eyebrow}</Eyebrow>
              <h2 className="text-2xl sm:text-3xl font-bold text-white">{t.studio.title}</h2>
              <p className="text-slate-400 mt-3 max-w-2xl mx-auto leading-relaxed">{t.studio.desc}</p>
            </div>
            <LessonStudio copy={t.studio} />
          </div>
        </div>
      </section>

      <section className="border-y border-slate-800/80 bg-slate-900/30">
        <div className={`${WRAP} py-16 sm:py-20`}>
          <Institutions copy={t.institutions} />
        </div>
      </section>

      <section className={`${WRAP} py-16 sm:py-20`}>
        <Journey copy={t.journey} />
      </section>

      <section className={`${WRAP} py-16 sm:py-20`}>
        <Capabilities copy={t.capabilities} />
      </section>

      <section className={`${WRAP} py-16 sm:py-20`}>
        <Privacy copy={t.privacy} />
      </section>

      <section className={`${WRAP} py-16 sm:py-20`}>
        <Fairness copy={t.fairness} />
      </section>

      <section className={`${WRAP} py-16 sm:py-20 grid lg:grid-cols-2 gap-6`}>
        <CentrePermissions copy={t.centre} />
        <Insights copy={t.insights} />
      </section>

      {/* Safeguards */}
      <section className={`${WRAP} py-16 sm:py-20`}>
        <SectionHead eyebrow={t.trust.eyebrow} title={t.trust.title} center />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {t.trust.items.map(item => (
            <div key={item.title} className={`${PANEL} p-6 border-s-2 border-s-blue-500/70`}>
              <h3 className="text-white font-semibold text-lg">{item.title}</h3>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bilingual */}
      <section className={`${WRAP} py-12 sm:py-16`}>
        <div className={`${PANEL} p-7 sm:p-10 grid lg:grid-cols-2 gap-8 items-center`}>
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white">{t.bilingual.title}</h2>
            <p className="text-slate-400 mt-4 leading-relaxed">{t.bilingual.desc}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {LOCALES.map(l => (
              <div key={l} dir={LOCALE_DIR[l]} lang={l} className="rounded-2xl bg-slate-950/70 border border-slate-800 p-5 text-start">
                <span className="text-blue-400 text-xs font-bold">{l.toUpperCase()}</span>
                <p className="text-white mt-3 leading-relaxed">{l === 'ar' ? t.bilingual.sampleAr : t.bilingual.sampleEn}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Joining */}
      <section className={`${WRAP} py-16 sm:py-20`}>
        <SectionHead title={t.steps.title} center />
        <ol className="grid md:grid-cols-3 gap-4">
          {t.steps.items.map((s, i) => (
            <li key={s.title} className={`${PANEL} p-7`}>
              <span className="text-5xl font-extrabold text-blue-400">{i + 1}</span>
              <h3 className="text-white font-semibold text-lg mt-4">{s.title}</h3>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ */}
      <section id={FAQ_SECTION} className={`scroll-mt-24 ${WRAP} py-16 sm:py-20`}>
        <SectionHead title={t.faq.title} center />
        <FaqGrid items={t.faq.items} />
      </section>

      <CtaBand
        title={t.cta.title}
        desc={t.cta.desc}
        primary={{ label: t.cta.primary, href: contact }}
        secondary={{ label: t.cta.secondary, href: '/login' }}
      />

      <PublicFooter lang={lang} />
    </div>
  )
}
