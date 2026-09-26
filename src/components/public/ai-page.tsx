'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'
import { CtaBand, PANEL, PageHero, SectionHead, WRAP } from './ui'

// /ai: responsible AI. A filterable map of the platform's tasks (uses AI /
// on-device detection models / no AI), the review cycle every generated
// draft goes through, the rules of use, and what AI never does here.
// Facts mirror the codebase: generation routes under src/app/api/ai, grading
// in /api/exam/submit (objective auto, essays by the teacher), proctoring on
// the device with no AI provider, suggestions rule-based first.
// Copy: src/messages/<locale>/public.json → aiPage.
type AiCopy = typeof enPublic.aiPage
type Kind = 'ai' | 'local' | 'none'

const KINDS: Kind[] = ['ai', 'local', 'none']
const KIND_TONE: Record<Kind, string> = {
  ai: 'bg-blue-600/10 text-blue-300 border-blue-500/30',
  local: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  none: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
}
const KIND_BAR: Record<Kind, string> = { ai: 'bg-blue-500', local: 'bg-emerald-400', none: 'bg-slate-600' }
/** How long each stage of the review cycle stays highlighted. */
const FLOW_MS = 2200

function TaskMap({ copy }: { copy: AiCopy['map'] }) {
  const [filter, setFilter] = useState<Kind | null>(null)
  const tasks = filter ? copy.tasks.filter(t => t.kind === filter) : copy.tasks
  const chip = (on: boolean) =>
    `px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
      on ? 'bg-white text-slate-950 border-white' : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
    }`
  return (
    <>
      <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
      <div role="group" aria-label={copy.title} className="flex flex-wrap gap-2 mb-8">
        <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className={chip(filter === null)}>{copy.all}</button>
        {KINDS.map(k => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={chip(filter === k)}>{copy.badges[k]}</button>
        ))}
      </div>
      <div key={filter ?? 'all'} className="eq-menu-in grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tasks.map(task => {
          const kind = task.kind as Kind
          return (
            <article key={task.title} className={`${PANEL} relative overflow-hidden p-6`}>
              <span aria-hidden="true" className={`absolute inset-y-0 start-0 w-1 ${KIND_BAR[kind]}`} />
              <span className={`inline-block px-2.5 py-1 rounded-full border text-xs font-medium ${KIND_TONE[kind]}`}>{copy.badges[kind]}</span>
              <h3 className="text-white font-semibold text-lg mt-4">{task.title}</h3>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">{task.desc}</p>
            </article>
          )
        })}
      </div>
    </>
  )
}

/** Index of the human-review stage in `aiPage.flow.steps`. */
const HUMAN_STEP = 3

function ReviewFlow({ copy }: { copy: AiCopy['flow'] }) {
  const n = copy.steps.length
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // The human decision holds the highlight twice as long as the other stages.
    const wait = active === HUMAN_STEP ? FLOW_MS * 2 : FLOW_MS
    const id = window.setTimeout(() => setActive(a => (a + 1) % n), wait)
    return () => window.clearTimeout(id)
  }, [active, paused, n])

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="rounded-[2rem] border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-7 sm:p-12"
    >
      <SectionHead eyebrow={copy.eyebrow} title={copy.title} center />
      <ol className="relative grid gap-4 md:grid-cols-5">
        <span aria-hidden="true" className="hidden md:block absolute top-7 inset-x-[10%] h-0.5 bg-slate-800">
          <span
            className="block h-full bg-blue-500 transition-[width] duration-700 motion-reduce:transition-none"
            style={{ width: `${(active / (n - 1)) * 100}%` }}
          />
        </span>
        {copy.steps.map((s, i) => {
          const human = i === HUMAN_STEP
          const on = i === active
          return (
            <li key={s.title}>
              <button type="button" aria-pressed={on} onClick={() => { setActive(i); setPaused(true) }} className="w-full text-center group">
                <span
                  className={`relative mx-auto flex items-center justify-center w-14 h-14 rounded-2xl border-2 font-bold transition-colors ${
                    on
                      ? human ? 'bg-emerald-500 border-emerald-400 text-on-accent' : 'bg-blue-600 border-blue-500 text-on-accent'
                      : human ? 'bg-slate-950 border-emerald-500/60 text-emerald-300' : 'bg-slate-950 border-slate-700 text-slate-400 group-hover:border-slate-500'
                  }`}
                >
                  {i + 1}
                </span>
                {human && (
                  <span className="inline-block mt-3 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">{copy.humanBadge}</span>
                )}
                <span className={`block font-semibold ${human ? 'mt-2' : 'mt-4'} ${on ? 'text-white' : 'text-slate-300'}`}>{s.title}</span>
                <span className={`block text-sm mt-1.5 leading-relaxed transition-colors ${on ? 'text-slate-300' : 'text-slate-500'}`}>{s.desc}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function NoSign() {
  return (
    <span aria-hidden="true" className="relative mt-0.5 flex items-center justify-center w-6 h-6 rounded-full border-2 border-red-400/70 shrink-0">
      <span className="absolute w-3.5 h-0.5 rounded bg-red-400/80 -rotate-45" />
    </span>
  )
}

export function AiPage() {
  const [lang, setLang] = useLang()
  const t = useTranslations('public').raw('aiPage') as AiCopy

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />
      <PageHero eyebrow={t.hero.eyebrow} title={t.hero.title} desc={t.hero.desc} />

      <section className={`${WRAP} pb-16 sm:pb-24`}>
        <TaskMap copy={t.map} />
      </section>

      <section className={`${WRAP} py-12 sm:py-16`}>
        <ReviewFlow copy={t.flow} />
      </section>

      <section className={`${WRAP} py-16 sm:py-24 grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-6 items-start`}>
        <div>
          <SectionHead eyebrow={t.principles.eyebrow} title={t.principles.title} />
          <div className="grid sm:grid-cols-2 gap-4">
            {t.principles.items.map((p, i) => (
              <article key={p.title} className={`${PANEL} p-6 ${i === t.principles.items.length - 1 ? 'sm:col-span-2' : ''}`}>
                <h3 className="text-white font-semibold text-lg">{p.title}</h3>
                <p className="text-slate-400 text-sm mt-2 leading-relaxed">{p.desc}</p>
              </article>
            ))}
          </div>
        </div>
        <aside className="lg:sticky lg:top-24 rounded-3xl border border-red-400/25 bg-gradient-to-b from-red-500/10 to-slate-900/60 p-7 sm:p-9">
          <p className="text-red-300 text-sm font-semibold">{t.never.eyebrow}</p>
          <h2 className="text-white text-2xl font-bold mt-3 leading-snug">{t.never.title}</h2>
          <ul className="mt-7 space-y-4">
            {t.never.items.map(item => (
              <li key={item} className="flex gap-3 text-slate-200 leading-relaxed">
                <NoSign />
                {item}
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <CtaBand
        title={t.cta.title}
        desc={t.cta.desc}
        primary={{ label: t.cta.primary, href: localizedPath(lang, '/contact') }}
        secondary={{ label: t.cta.secondary, href: localizedPath(lang, '/demo') }}
      />

      <PublicFooter lang={lang} />
    </div>
  )
}
