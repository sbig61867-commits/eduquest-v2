'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import type enPublic from '@/messages/en/public.json'
import { localizedPath } from '@/i18n/public-routes'
import {
  FEATURE_ANCHORS, ROLE_ANCHORS, ROLES_SECTION, anchorSnapshot, roleAnchorId, subscribeAnchor,
} from './anchors'
import { CheckDot, CtaBand, PANEL, PageHero, SectionHead, WRAP } from './ui'

// /features: the platform's components as six chapters (each with its own
// CSS illustration), a sticky chapter bar that follows the scroll, and a role
// switcher the header menu can open directly (#role-teacher …).
//
// Copy: src/messages/<locale>/public.json → featuresPage (read with t.raw()).
// Chapter i carries the id FEATURE_ANCHORS[i]; the header menu links to them.
type FeaturesCopy = typeof enPublic.featuresPage
type Visuals = FeaturesCopy['visuals']
type Tone = 'high' | 'mid' | 'low'

const EVENT_TONE: Record<Tone, string> = {
  high: 'bg-red-500/15 text-red-300 border-red-500/30',
  mid: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
}
const GRADE_TONE: Record<string, string> = {
  auto: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  pending: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  published: 'bg-blue-600/10 text-blue-300 border-blue-500/30',
}

// ── Chapter illustrations ────────────────────────────────────────────────────

function Frame({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div aria-hidden="true" className="absolute -inset-6 bg-blue-600/10 blur-3xl rounded-[2rem]" />
      <div className="relative rounded-3xl border border-slate-700/60 bg-slate-900/90 shadow-2xl overflow-hidden">
        {label && (
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-800">
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
            <span className="text-slate-500 text-xs ms-2">{label}</span>
          </div>
        )}
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  )
}

function AiVisual({ v }: { v: Visuals['ai'] }) {
  return (
    <Frame>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 sm:gap-5 items-center">
        <div>
          <p className="text-slate-500 text-xs font-semibold mb-3">{v.inputsLabel}</p>
          <ul className="space-y-2">
            {v.inputs.map(i => (
              <li key={i} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-300 text-sm">{i}</li>
            ))}
          </ul>
        </div>
        <div aria-hidden="true" className="relative h-full w-8 flex items-center justify-center">
          <span className="absolute inset-y-6 w-px bg-gradient-to-b from-transparent via-blue-500/60 to-transparent" />
          <span className="relative w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-blue-400 motion-safe:animate-ping" />
          </span>
        </div>
        <div>
          <p className="text-slate-500 text-xs font-semibold mb-3">{v.outputsLabel}</p>
          <ul className="space-y-2">
            {v.outputs.map(o => (
              <li key={o} className="rounded-xl border border-blue-500/30 bg-blue-600/10 px-3 py-2 text-blue-200 text-sm">{o}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-5 flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-emerald-300 text-sm">
        <CheckDot tone="bg-emerald-500" />
        {v.review}
      </p>
    </Frame>
  )
}

function ProctoringVisual({ v, studentN }: { v: Visuals['proctoring']; studentN: (n: number) => string }) {
  return (
    <Frame label={v.wallLabel}>
      <div className="grid grid-cols-3 gap-2.5">
        {[1, 2, 3, 4, 5, 6].map(n => (
          <div
            key={n}
            className={`relative aspect-video rounded-xl border-2 overflow-hidden bg-slate-800 ${
              n === 2 ? 'border-emerald-400 shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-emerald-400)_25%,transparent)]' : 'border-slate-700'
            }`}
          >
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-slate-700/50 to-slate-900" />
            <span aria-hidden="true" className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-600/80" />
            <span aria-hidden="true" className="absolute left-1/2 top-[72%] -translate-x-1/2 -translate-y-1/2 w-10 h-4 rounded-t-full bg-slate-600/80" />
            {n === 2 && (
              <span className="absolute top-1.5 end-1.5 px-1.5 py-0.5 rounded-full bg-emerald-600 text-on-accent text-[10px] font-bold">{v.speaking}</span>
            )}
            <span className="absolute bottom-1 start-1.5 text-white/80 text-[10px]">{studentN(n)}</span>
          </div>
        ))}
      </div>
      <p className="text-slate-500 text-xs font-semibold mt-5 mb-2">{v.eventsLabel}</p>
      <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/50">
        {v.events.map(e => (
          <li key={e.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="text-slate-300">{e.label}</span>
            <span className={`px-2.5 py-0.5 rounded-full border text-xs ${EVENT_TONE[e.tone as Tone]}`}>{e.level}</span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

function IsolationVisual({ v }: { v: Visuals['isolation'] }) {
  return (
    <Frame>
      <div className="grid grid-cols-3 gap-0">
        {v.tenants.map((name, i) => (
          <div key={name} className={`px-3 sm:px-4 py-2 ${i > 0 ? 'border-s-2 border-double border-blue-500/50' : ''}`}>
            <p className="text-white font-semibold text-sm text-center">{name}</p>
            <p className="text-slate-500 text-[11px] text-center mt-1">{v.recordsLabel}</p>
            <div aria-hidden="true" className="mt-4 space-y-2">
              {[0, 1, 2, 3].map(r => (
                <div key={r} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 space-y-1.5">
                  <span className="block h-1.5 rounded bg-slate-700" style={{ width: `${80 - r * 12}%` }} />
                  <span className="block h-1 rounded bg-slate-800" style={{ width: `${55 - r * 8}%` }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-center rounded-xl border border-blue-500/30 bg-blue-600/10 px-4 py-2.5 text-blue-200 text-sm font-medium">{v.wall}</p>
    </Frame>
  )
}

function InvitationsVisual({ v }: { v: Visuals['invitations'] }) {
  const cards = [
    { c: v.personal, band: 'from-blue-600/30', chip: 'bg-blue-600', tilt: 'lg:-rotate-2' },
    { c: v.open, band: 'from-violet-600/30', chip: 'bg-violet-600', tilt: 'lg:rotate-2 lg:-mt-6 lg:ms-10' },
  ]
  return (
    <div className="relative grid gap-5">
      <div aria-hidden="true" className="absolute -inset-6 bg-violet-600/10 blur-3xl rounded-[2rem]" />
      {cards.map(({ c, band, chip, tilt }) => (
        <div key={c.label} className={`relative max-w-sm w-full rounded-3xl border border-slate-700/60 bg-slate-900/95 shadow-2xl overflow-hidden ${tilt}`}>
          <div className={`px-5 pt-5 pb-4 bg-gradient-to-b ${band} to-transparent`}>
            <span className={`inline-block px-3 py-1 rounded-full text-on-accent text-xs font-semibold ${chip}`}>{c.label}</span>
          </div>
          <div aria-hidden="true" className="relative h-5">
            <span className="absolute inset-x-5 top-1/2 border-t-2 border-dashed border-slate-700" />
            <span className="absolute -start-2.5 top-0 w-5 h-5 rounded-full bg-slate-950 border border-slate-800" />
            <span className="absolute -end-2.5 top-0 w-5 h-5 rounded-full bg-slate-950 border border-slate-800" />
          </div>
          <dl className="px-5 pb-5 pt-2 space-y-2.5">
            {c.rows.map(r => (
              <div key={r.k} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-slate-500">{r.k}</dt>
                <dd className="text-white font-medium" dir="auto">{r.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

function GradesVisual({ v }: { v: Visuals['grades'] }) {
  return (
    <Frame label={v.title}>
      <ul className="space-y-2.5">
        {v.rows.map(r => (
          <li key={r.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
            <span className="flex items-center gap-3 min-w-0">
              <span aria-hidden="true" className="w-8 h-8 rounded-full bg-slate-800 shrink-0" />
              <span className="text-slate-200 text-sm truncate">{r.name}</span>
            </span>
            <span className={`shrink-0 px-2.5 py-1 rounded-full border text-xs ${GRADE_TONE[r.tone]}`}>{r.status}</span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

function GroupsVisual({ v }: { v: Visuals['groups'] }) {
  return (
    <Frame>
      <div className="rounded-xl bg-blue-600/10 border border-blue-500/30 px-4 py-3 text-blue-200 font-semibold">{v.course}</div>
      <div className="ms-5 border-s border-slate-700 ps-5 pt-3 space-y-3">
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-2.5 text-white text-sm font-medium">{v.level}</div>
        <div className="ms-5 border-s border-slate-700 ps-5 space-y-2.5">
          {v.units.map((u, i) => (
            <div key={u.name}>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-2.5 text-sm">
                <span className="text-slate-200">{u.name}</span>
                <span className={`px-2.5 py-0.5 rounded-full border text-xs ${i === 0 ? GRADE_TONE.auto : GRADE_TONE.published}`}>{u.state}</span>
              </div>
              {i === v.units.length - 1 && (
                <ul className="mt-2.5 ms-5 border-s border-dashed border-slate-700 ps-5 grid grid-cols-2 gap-2">
                  {v.items.map(item => (
                    <li key={item} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-400 text-xs">{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  )
}

// ── Sticky chapter bar with scroll tracking ─────────────────────────────────

function ChapterBar({ labels, ids, label }: { labels: string[]; ids: string[]; label: string }) {
  const [active, setActive] = useState(ids[0])

  useEffect(() => {
    const sections = ids.map(id => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    // A section is "current" while it crosses the middle band of the viewport.
    const io = new IntersectionObserver(
      entries => {
        const hit = entries.find(e => e.isIntersecting)
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    sections.forEach(s => io.observe(s))
    return () => io.disconnect()
  }, [ids])

  return (
    <nav aria-label={label} className="sticky top-0 z-30 border-y border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
      <ul className={`${WRAP} flex gap-1.5 overflow-x-auto py-2.5 [scrollbar-width:none]`}>
        {labels.map((l, i) => (
          <li key={ids[i]} className="shrink-0">
            <a
              href={`#${ids[i]}`}
              aria-current={active === ids[i] ? 'true' : undefined}
              className={`block px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
                active === ids[i] ? 'bg-blue-600 text-on-accent' : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              {l}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ── Roles ───────────────────────────────────────────────────────────────────

function NoDot() {
  return (
    <span aria-hidden="true" className="mt-0.5 flex items-center justify-center w-5 h-5 rounded-full border border-slate-600 shrink-0">
      <span className="block w-2.5 h-0.5 rounded bg-slate-500" />
    </span>
  )
}

function RoleTabs({ copy }: { copy: FeaturesCopy['roles'] }) {
  // The header menu can point at a role (#role-teacher); a click inside the
  // tabs wins until the menu points somewhere else.
  const anchor = useSyncExternalStore(subscribeAnchor, anchorSnapshot, () => '')
  const [picked, setPicked] = useState<{ index: number; anchor: string } | null>(null)
  const fromAnchor = ROLE_ANCHORS.findIndex(r => roleAnchorId(r) === anchor)
  const active = picked && picked.anchor === anchor ? picked.index : fromAnchor >= 0 ? fromAnchor : 0
  const role = copy.items[active]

  return (
    <>
      <div role="tablist" aria-label={copy.title} className="flex flex-wrap gap-2 mb-6">
        {copy.items.map((r, i) => (
          <button
            key={r.tab}
            id={roleAnchorId(ROLE_ANCHORS[i])}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls="role-panel"
            onClick={() => setPicked({ index: i, anchor })}
            className={`scroll-mt-32 px-5 py-2.5 rounded-full border text-sm font-medium transition-colors ${
              i === active ? 'bg-blue-600 border-blue-600 text-on-accent' : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
            }`}
          >
            {r.tab}
          </button>
        ))}
      </div>
      <div id="role-panel" role="tabpanel" key={active} className={`eq-menu-in ${PANEL} p-7 sm:p-10`}>
        <p className="text-white text-xl sm:text-2xl font-semibold leading-snug max-w-3xl">{role.summary}</p>
        <div className="mt-8 grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-8">
          <div>
            <p className="text-emerald-300 text-sm font-semibold mb-4">{copy.canLabel}</p>
            <ul className="space-y-3">
              {role.can.map(c => (
                <li key={c} className="flex gap-3 text-slate-300 leading-relaxed">
                  <CheckDot tone="bg-emerald-500" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
            <p className="text-slate-400 text-sm font-semibold mb-4">{copy.cannotLabel}</p>
            <ul className="space-y-3">
              {role.cannot.map(c => (
                <li key={c} className="flex gap-3 text-slate-400 text-sm leading-relaxed">
                  <NoDot />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export function FeaturesPage() {
  const [lang, setLang] = useLang()
  const tf = useTranslations('public.featuresPage')
  const t = useTranslations('public').raw('featuresPage') as FeaturesCopy
  const studentN = (n: number) => tf('studentN', { n })

  const visuals: React.ReactNode[] = [
    <AiVisual key="ai" v={t.visuals.ai} />,
    <ProctoringVisual key="proctoring" v={t.visuals.proctoring} studentN={studentN} />,
    <IsolationVisual key="isolation" v={t.visuals.isolation} />,
    <InvitationsVisual key="invitations" v={t.visuals.invitations} />,
    <GradesVisual key="grades" v={t.visuals.grades} />,
    <GroupsVisual key="groups" v={t.visuals.groups} />,
  ]
  const barIds = [...FEATURE_ANCHORS, ROLES_SECTION]
  const barLabels = [...t.chapters.map(c => c.tag), t.roles.nav]

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />
      <PageHero eyebrow={t.hero.eyebrow} title={t.hero.title} desc={t.hero.desc} />
      <ChapterBar labels={barLabels} ids={barIds} label={t.navLabel} />

      {t.chapters.map((c, i) => (
        <section key={FEATURE_ANCHORS[i]} id={FEATURE_ANCHORS[i]} className={`scroll-mt-20 ${i % 2 ? 'bg-slate-900/30 border-y border-slate-800/60' : ''}`}>
          <div className={`${WRAP} py-16 sm:py-24 grid lg:grid-cols-2 gap-12 lg:gap-20 items-center`}>
            <div className={i % 2 ? 'lg:order-2' : ''}>
              <div className="flex items-center gap-4 mb-5">
                <span aria-hidden="true" className="text-5xl sm:text-6xl font-extrabold text-slate-800 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span className="px-3 py-1 rounded-full bg-blue-600/10 border border-blue-500/25 text-blue-300 text-xs font-semibold">{c.tag}</span>
              </div>
              <h2 className="text-2xl sm:text-4xl font-bold text-white leading-snug">{c.title}</h2>
              <p className="text-slate-400 mt-4 text-base sm:text-lg leading-relaxed">{c.desc}</p>
              <ul className="mt-7 space-y-3">
                {c.points.map(p => (
                  <li key={p} className="flex gap-3 text-slate-300 leading-relaxed">
                    <CheckDot />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className={i % 2 ? 'lg:order-1' : ''}>{visuals[i]}</div>
          </div>
        </section>
      ))}

      <section id={ROLES_SECTION} className={`scroll-mt-20 ${WRAP} py-16 sm:py-24`}>
        <SectionHead eyebrow={t.roles.eyebrow} title={t.roles.title} desc={t.roles.desc} />
        <RoleTabs copy={t.roles} />
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
