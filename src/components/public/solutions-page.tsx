'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import { CheckDot, CtaBand, PageHero, SectionHead, WRAP } from './ui'
import { DEMO_ROLES, SOLUTION_SLUGS, localizedPath, roleTourPath } from '@/i18n/public-routes'
import type { Terms } from '@/lib/terminology'
import type { getDemoData } from '@/lib/demo/data'
import type enPublic from '@/messages/en/public.json'

// /solutions/<type>: one page per institution type. The page (server) hands in
// the demo fixtures (src/lib/demo/data.ts) and the tenant vocabulary for that
// type (src/lib/terminology.ts), so the guided tour relabels itself exactly as
// the product does. Copy: public.json → solutions (common part + types.<type>).

export type SolutionType = 'university' | 'institute' | 'training_center' | 'school'
type Copy = typeof enPublic.solutions
type Screen = Copy['tour']['screen']
type Demo = ReturnType<typeof getDemoData>
export type RoleTitles = { admin: string; centre: string; teacher: string; student: string }

const STOPS = ['dashboard', 'structure', 'courses', 'exams', 'schedule', 'reports'] as const
type Stop = (typeof STOPS)[number]
const ROLE_KEYS = ['admin', 'centre', 'teacher', 'student'] as const

// ── Screens ──────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="py-3 px-4">
      <p className="text-fg-3 text-xs">{label}</p>
      <p className="text-fg text-2xl font-semibold mt-1 tabular-nums">{value}</p>
    </div>
  )
}

function Pill({ tone, children }: { tone: 'ok' | 'wait' | 'muted'; children: React.ReactNode }) {
  const cls = tone === 'ok' ? 'bg-success-subtle text-success' : tone === 'wait' ? 'bg-warning-subtle text-warning' : 'bg-elevated text-fg-2'
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>{children}</span>
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-fg-3 text-xs font-semibold mb-2">{children}</p>
}

function DashboardScreen({ d, s, terms, roles }: { d: Demo; s: Screen; terms: Terms; roles: RoleTitles }) {
  const next = d.upcomingExams[0]
  const latest = d.announcements[0]
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-line rtl:divide-x-reverse border border-line rounded-lg">
        <Stat label={roles.teacher} value={d.stats.teachers} />
        <Stat label={terms.institutionStudents} value={d.stats.students} />
        <Stat label={s.courses} value={d.stats.courses} />
        <Stat label={s.exams} value={d.stats.exams} />
      </div>
      <div className="grid sm:grid-cols-2 gap-6">
        {next && (
          <div>
            <Label>{s.upcoming}</Label>
            <p className="text-fg font-medium">{next.title}</p>
            <p className="text-fg-2 text-sm mt-1"><span dir="ltr">{next.date}</span> · {next.duration} {s.minutes}</p>
          </div>
        )}
        {latest && (
          <div>
            <Label>{s.latest}</Label>
            <p className="text-fg font-medium">{latest.title}</p>
            <p className="text-fg-2 text-sm mt-1 leading-relaxed">{latest.body}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function StructureScreen({ d, s, terms, tree }: { d: Demo; s: Screen; terms: Terms; tree: { name: string; children: string[] }[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-6">
      <div>
        <Label>{terms.unitsL1} · {terms.unitsL2}</Label>
        <ul className="space-y-3">
          {tree.map(node => (
            <li key={node.name}>
              <p className="text-fg font-medium">{node.name}</p>
              <ul className="mt-1.5 ms-3 border-s border-line ps-3 space-y-1">
                {node.children.map(c => <li key={c} className="text-fg-2 text-sm">{c}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <Label>{terms.groups}</Label>
        <ul className="divide-y divide-line border-y border-line">
          {d.teacherGroups.map(g => (
            <li key={g.name} className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-fg">{g.name}</span>
              <span className="text-fg-3">{s.students} <span className="tabular-nums text-fg-2">{g.count}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CoursesScreen({ d, s }: { d: Demo; s: Screen }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-fg-3 text-xs text-start border-b border-line">
          <th className="py-2 text-start font-semibold">{s.course}</th>
          <th className="py-2 text-start font-semibold hidden sm:table-cell">{s.level}</th>
          <th className="py-2 text-start font-semibold">{s.units}</th>
          <th className="py-2 text-start font-semibold">{s.status}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {d.courses.map(c => (
          <tr key={c.id}>
            <td className="py-3 text-fg font-medium">{c.title}</td>
            <td className="py-3 text-fg-2 hidden sm:table-cell">{c.level}</td>
            <td className="py-3 text-fg-2 tabular-nums">{c.units}</td>
            <td className="py-3"><Pill tone={c.published ? 'ok' : 'muted'}>{c.published ? s.published : s.draft}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ExamsScreen({ d, s }: { d: Demo; s: Screen }) {
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-fg-3 text-xs border-b border-line">
            <th className="py-2 text-start font-semibold">{s.exams}</th>
            <th className="py-2 text-start font-semibold hidden sm:table-cell">{s.date}</th>
            <th className="py-2 text-start font-semibold">{s.minutes}</th>
            <th className="py-2 text-start font-semibold hidden sm:table-cell">{s.submissions}</th>
            <th className="py-2 text-start font-semibold">{s.status}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {d.exams.map(e => (
            <tr key={e.id}>
              <td className="py-3 text-fg font-medium">{e.title}</td>
              <td className="py-3 text-fg-2 hidden sm:table-cell" dir="ltr">{e.date}</td>
              <td className="py-3 text-fg-2 tabular-nums">{e.duration}</td>
              <td className="py-3 text-fg-2 tabular-nums hidden sm:table-cell">{e.submissions}</td>
              <td className="py-3"><Pill tone={e.status === 'graded' ? 'ok' : 'wait'}>{e.status === 'graded' ? s.graded : s.scheduled}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2 mt-5">
        <Pill tone="muted">{s.serverNote}</Pill>
        <Pill tone="muted">{s.proctorNote}</Pill>
      </div>
    </div>
  )
}

function ScheduleScreen({ d, s }: { d: Demo; s: Screen }) {
  const days = useTranslations('common.days')
  return (
    <div className="grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-6">
      <div>
        <Label>{s.weekly}</Label>
        <ul className="divide-y divide-line border-y border-line">
          {d.schedule.map(row => (
            <li key={row.day} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
              <span className="text-fg-3">{days(String(row.day))}</span>
              <span className="text-fg space-y-0.5">{row.slots.map(slot => <span key={slot} className="block">{slot}</span>)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-6">
        <div>
          <Label>{s.announcements}</Label>
          <ul className="space-y-3">
            {d.announcements.map(a => (
              <li key={a.id}>
                <p className="text-fg text-sm font-medium">{a.title}</p>
                <p className="text-fg-3 text-xs mt-0.5" dir="ltr">{a.date}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Label>{s.requests}</Label>
          <ul className="space-y-2">
            {d.requests.map(r => (
              <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-fg-2">{r.subject}</span>
                <Pill tone={r.status === 'answered' ? 'ok' : 'wait'}>{r.status === 'answered' ? s.answered : s.pending}</Pill>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function ReportsScreen({ d, s }: { d: Demo; s: Screen }) {
  return (
    <div className="grid sm:grid-cols-2 gap-6">
      <div>
        <Label>{s.averages}</Label>
        <ul className="space-y-3">
          {d.students.map(st => (
            <li key={st.id} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-fg">{st.name}</span>
                <span className="text-fg-2 tabular-nums">{st.avgGrade}%</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-elevated overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: `${st.avgGrade}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <Label>{s.recent}</Label>
        <ul className="divide-y divide-line border-y border-line">
          {d.grades.map(g => (
            <li key={g.exam} className="flex justify-between gap-3 py-2.5 text-sm">
              <span className="text-fg">{g.exam}</span>
              <span className="text-fg-2 tabular-nums" dir="ltr">{g.score} / {g.outOf}</span>
            </li>
          ))}
        </ul>
        <p className="text-fg-3 text-xs mt-3">{s.appeal}</p>
      </div>
    </div>
  )
}

// ── Guided tour ──────────────────────────────────────────────────────────────

function Tour({ copy, d, terms, roles, tree }: {
  copy: Copy['tour']; d: Demo; terms: Terms; roles: RoleTitles; tree: { name: string; children: string[] }[]
}) {
  const [active, setActive] = useState<Stop>('dashboard')
  const tabs = useRef<Partial<Record<Stop, HTMLButtonElement | null>>>({})
  const s = copy.screen

  function onKey(e: React.KeyboardEvent, i: number) {
    const rtl = document.documentElement.dir === 'rtl'
    const delta: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }
    let next = i
    if (e.key in delta) next = (i + delta[e.key] + STOPS.length) % STOPS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = STOPS.length - 1
    else return
    e.preventDefault()
    setActive(STOPS[next])
    tabs.current[STOPS[next]]?.focus()
  }

  const screen: Record<Stop, React.ReactNode> = {
    dashboard: <DashboardScreen d={d} s={s} terms={terms} roles={roles} />,
    structure: <StructureScreen d={d} s={s} terms={terms} tree={tree} />,
    courses: <CoursesScreen d={d} s={s} />,
    exams: <ExamsScreen d={d} s={s} />,
    schedule: <ScheduleScreen d={d} s={s} />,
    reports: <ReportsScreen d={d} s={s} />,
  }
  const stop = copy.stops[active]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] gap-8 lg:gap-12 items-start">
      <div>
        <div role="tablist" aria-label={copy.railLabel} aria-orientation="vertical" className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible border-b lg:border-b-0 lg:border-s border-line pb-2 lg:pb-0">
          {STOPS.map((key, i) => {
            const selected = key === active
            return (
              <button
                key={key}
                ref={el => { tabs.current[key] = el }}
                id={`sol-tab-${key}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls="sol-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(key)}
                onKeyDown={e => onKey(e, i)}
                className={`shrink-0 flex items-center gap-3 text-start px-3 lg:ps-4 py-2.5 lg:-ms-px lg:border-s-2 rounded-md lg:rounded-none text-sm transition-colors whitespace-nowrap ${
                  selected ? 'text-fg font-semibold lg:border-accent bg-accent-subtle lg:bg-transparent' : 'text-fg-2 hover:text-fg lg:border-transparent'
                }`}
              >
                <span aria-hidden="true" className={`tabular-nums text-xs ${selected ? 'text-accent' : 'text-fg-3'}`}>{String(i + 1).padStart(2, '0')}</span>
                {copy.stops[key].label}
              </button>
            )
          })}
        </div>
        <div key={active} className="eq-menu-in mt-6 hidden lg:block">
          <p className="text-fg leading-relaxed">{stop.desc}</p>
          <p className="text-fg-3 text-xs font-semibold mt-5">{copy.whoLabel}</p>
          <p className="text-fg-2 text-sm mt-1 leading-relaxed">{stop.who}</p>
        </div>
      </div>

      <div>
        <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-canvas">
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-line-strong" />
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-line-strong" />
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-line-strong" />
            <span className="ms-3 flex-1 truncate rounded-md bg-surface border border-line px-3 py-1 text-fg-3 text-xs">
              {terms.institution} · {stop.label}
            </span>
          </div>
          <div id="sol-panel" role="tabpanel" aria-labelledby={`sol-tab-${active}`} tabIndex={0} className="p-4 sm:p-6 min-h-[22rem] outline-none">
            <p className="text-fg text-lg font-semibold mb-5">{stop.label}</p>
            <div key={active} className="eq-menu-in">{screen[active]}</div>
          </div>
        </div>
        <div className="lg:hidden mt-5">
          <p className="text-fg leading-relaxed">{stop.desc}</p>
          <p className="text-fg-2 text-sm mt-2">{copy.whoLabel}. {stop.who}</p>
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SolutionsPage({ type, demo, terms, roles }: { type: SolutionType; demo: Demo; terms: Terms; roles: RoleTitles }) {
  const c = useTranslations('public').raw('solutions') as Copy
  const [lang, setLang] = useLang()
  const x = c.types[type]

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <PublicNav lang={lang} setLang={setLang} />

      <PageHero eyebrow={x.hero.eyebrow} title={x.hero.title} desc={x.hero.desc}>
        <div className="flex flex-col sm:flex-row gap-3 mt-9">
          <Link href={localizedPath(lang, '/contact')} className="px-7 py-3 rounded-lg bg-accent hover:bg-accent-hover text-on-accent font-semibold text-center transition-colors">
            {c.primary}
          </Link>
          <Link href={localizedPath(lang, '/demo')} className="px-7 py-3 rounded-lg border border-line-strong text-fg hover:bg-elevated font-semibold text-center transition-colors">
            {c.secondary}
          </Link>
        </div>
      </PageHero>

      <section className={`eq-pub-band ${WRAP} py-12 sm:py-16`}>
        <SectionHead eyebrow={c.pick.eyebrow} title={c.pick.title} desc={c.pick.desc} />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {DEMO_ROLES.map(r => (
            <li key={r}>
              <Link
                href={localizedPath(lang, roleTourPath(`/solutions/${SOLUTION_SLUGS[type]}`, r))}
                className="eq-pub-card flex h-full flex-col justify-between gap-6 rounded-lg border border-line bg-surface p-6 transition-colors hover:border-accent"
              >
                <span className="text-fg text-lg font-semibold">{roles[r === 'center' ? 'centre' : r]}</span>
                <span className="text-accent text-sm font-semibold">{c.pick.open}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={`eq-pub-glow ${WRAP} py-12 sm:py-16`}>
        <SectionHead eyebrow={c.tour.eyebrow} title={c.tour.title} desc={c.tour.desc} />
        <Tour copy={c.tour} d={demo} terms={terms} roles={roles} tree={x.structure} />
      </section>

      <section className={`eq-pub-band ${WRAP} py-12 sm:py-16`}>
        <SectionHead eyebrow={c.roles.eyebrow} title={c.roles.title} desc={c.roles.desc} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-10">
          {ROLE_KEYS.map(r => (
            <div key={r} className="border-t-2 border-accent pt-5">
              <h3 className="text-fg text-lg font-semibold">{roles[r]}</h3>
              <ul className="mt-4 space-y-3">
                {x.roles[r].map(p => (
                  <li key={p} className="flex gap-3 text-fg-2 text-sm leading-relaxed"><CheckDot tone="bg-accent" />{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={`eq-pub-glow ${WRAP} py-12 sm:py-16`}>
        <SectionHead eyebrow={c.changes.eyebrow} title={c.changes.title} />
        <div className="border-y border-line">
          <div className="hidden sm:grid grid-cols-2 gap-8 py-3 text-fg-3 text-xs font-semibold border-b border-line">
            <span>{c.changes.before}</span>
            <span>{c.changes.after}</span>
          </div>
          <ul className="divide-y divide-line">
            {x.changes.map(row => (
              <li key={row.after} className="grid sm:grid-cols-2 gap-2 sm:gap-8 py-4">
                <p className="text-fg-3 leading-relaxed"><span className="sm:hidden text-xs font-semibold block">{c.changes.before}</span>{row.before}</p>
                <p className="text-fg leading-relaxed flex gap-3"><CheckDot tone="bg-accent" /><span>{row.after}</span></p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand
        title={c.cta.title}
        desc={c.cta.desc}
        primary={{ label: c.primary, href: localizedPath(lang, '/contact') }}
        secondary={{ label: c.secondary, href: localizedPath(lang, '/demo') }}
      />

      <PublicFooter lang={lang} />
    </div>
  )
}
