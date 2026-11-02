'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CheckDot, SectionHead } from './ui'
import type { Lang } from './shell'
import type enPublic from '@/messages/en/public.json'
import { DEMO_ROLES, SOLUTION_SLUGS, localizedPath, roleTourPath, type DemoInstitutionType } from '@/i18n/public-routes'
import { getTerms } from '@/lib/terminology'
import { getRoleLabel } from '@/lib/utils'
import type { Role } from '@/types'

// Home page sections added 2026-10-31: solutions by institution, role tours,
// responsible AI, security at a glance and devices. Token classes only; the
// copy lives in public.landing.{solutionsBy,byRole,responsibleAi,securityGlance,devices}.

type LandingCopy = typeof enPublic.landing

/** Sample rows for the device frames, picked from the demo fixtures on the server. */
export type DeviceSample = { course: string; units: number; courses: number; exam: string; duration: number; announcement: string }

const LINK = 'inline-flex text-accent hover:text-accent-hover text-sm font-semibold underline-offset-4 hover:underline'
const TYPES = Object.keys(SOLUTION_SLUGS) as DemoInstitutionType[]

/** a) Four institution types, each with its own vocabulary and solution page. */
export function SolutionsByInstitution({ copy, lang }: { copy: LandingCopy['solutionsBy']; lang: Lang }) {
  const [active, setActive] = useState<DemoInstitutionType>('university')
  const terms = getTerms(active, lang)
  const rows: [string, string][] = [
    [copy.levels, `${terms.unitsL1} · ${terms.unitsL2}`],
    [copy.groups, terms.groups],
    [copy.period, terms.term],
    [copy.members, terms.institutionStudents],
  ]
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-start">
      <div>
        <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
        <ul className="-mt-2 border-t border-line divide-y divide-line">
          {TYPES.map(type => {
            const on = type === active
            return (
              <li key={type}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActive(type)}
                  className={`w-full flex items-start gap-4 py-4 text-start transition-colors ${on ? 'text-fg' : 'text-fg-2 hover:text-fg'}`}
                >
                  <span aria-hidden="true" className={`mt-2 w-2 h-2 rounded-full shrink-0 ${on ? 'bg-accent' : 'bg-line-strong'}`} />
                  <span className="min-w-0">
                    <span className="block font-semibold">{getTerms(type, lang).institutionTypeLabel}</span>
                    <span className="block text-fg-3 text-sm mt-1 leading-relaxed">{copy.blurbs[type]}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <div key={active} className="eq-menu-in rounded-lg border border-line bg-surface">
        <p className="px-6 py-4 border-b border-line text-fg font-semibold">{terms.institution}</p>
        <dl className="divide-y divide-line">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 px-6 py-4 text-sm">
              <dt className="text-fg-3">{label}</dt>
              <dd className="text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="px-6 py-4 border-t border-line">
          <Link href={localizedPath(lang, `/solutions/${SOLUTION_SLUGS[active]}`)} className={LINK}>{copy.open}</Link>
        </div>
      </div>
    </div>
  )
}

const ROLE_OF: Record<(typeof DEMO_ROLES)[number], Role> = {
  student: 'student', teacher: 'teacher', admin: 'university_admin', center: 'center_manager',
}

/** b) One row per role: what it sees, and a link to its university tour. */
export function TryByRole({ copy, lang }: { copy: LandingCopy['byRole']; lang: Lang }) {
  return (
    <>
      <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
      <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-10">
        {DEMO_ROLES.map(r => (
          <li key={r} className="flex flex-col border-t-2 border-accent pt-4">
            <h3 className="text-fg text-lg font-semibold">{getRoleLabel(ROLE_OF[r], 'university', lang)}</h3>
            <ul className="mt-4 space-y-3 flex-1">
              {copy.roles[r].map(p => (
                <li key={p} className="flex gap-3 text-fg-2 text-sm leading-relaxed"><CheckDot tone="bg-accent" />{p}</li>
              ))}
            </ul>
            <Link href={localizedPath(lang, roleTourPath('/demo', r))} className={`${LINK} mt-6`}>{copy.open}</Link>
          </li>
        ))}
      </ul>
    </>
  )
}

/** A titled list separated by hairlines (shared by the AI and security sections). */
function HairlineList({ items, numbered }: { items: { title: string; desc: string }[]; numbered?: boolean }) {
  return (
    <ol className="border-t border-line divide-y divide-line">
      {items.map((it, i) => (
        <li key={it.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 py-4">
          {numbered ? <span className="text-accent font-semibold tabular-nums">{i + 1}</span> : <CheckDot tone="bg-accent" />}
          <span>
            <span className="block text-fg font-semibold">{it.title}</span>
            <span className="block text-fg-2 text-sm mt-1 leading-relaxed">{it.desc}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** c) What the AI does, and what stays with the instructor. */
export function ResponsibleAi({ copy, lang }: { copy: LandingCopy['responsibleAi']; lang: Lang }) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-10 lg:gap-16 items-start">
      <div>
        <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
        <Link href={localizedPath(lang, '/ai')} className={`${LINK} -mt-4`}>{copy.link}</Link>
      </div>
      <HairlineList items={copy.items} numbered />
    </div>
  )
}

/** d) Six true facts in two columns, link to /security. */
export function SecurityGlance({ copy, lang }: { copy: LandingCopy['securityGlance']; lang: Lang }) {
  const half = Math.ceil(copy.items.length / 2)
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10 sm:mb-12">
        <div className="[&>div]:mb-0">
          <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
        </div>
        <Link href={localizedPath(lang, '/security')} className={`${LINK} shrink-0`}>{copy.link}</Link>
      </div>
      <div className="grid md:grid-cols-2 gap-x-12">
        <HairlineList items={copy.items.slice(0, half)} />
        <HairlineList items={copy.items.slice(half)} />
      </div>
    </>
  )
}

/** The small dashboard both device frames show. */
function Screen({ copy, d, compact }: { copy: LandingCopy['devices']; d: DeviceSample; compact?: boolean }) {
  return (
    <div className={`space-y-3 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="rounded-md border border-line bg-canvas p-3">
        <p className="text-fg-3 text-xs">{copy.nextExam}</p>
        <p className="text-fg text-sm font-semibold mt-1">{d.exam}</p>
        <p className="text-accent text-xs mt-1 tabular-nums">{d.duration} {copy.duration}</p>
      </div>
      <div className="rounded-md border border-line bg-canvas p-3">
        <p className="text-fg-3 text-xs">{copy.latest}</p>
        <p className="text-fg text-sm mt-1">{d.announcement}</p>
      </div>
      {!compact && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-line bg-canvas p-3">
            <p className="text-fg-3 text-xs">{copy.courses}</p>
            <p className="text-fg text-lg font-semibold tabular-nums">{d.courses}</p>
          </div>
          <div className="rounded-md border border-line bg-canvas p-3">
            <p className="text-fg-3 text-xs truncate">{d.course}</p>
            <p className="text-fg text-lg font-semibold tabular-nums">{d.units} <span className="text-fg-3 text-xs font-normal">{copy.units}</span></p>
          </div>
        </div>
      )}
    </div>
  )
}

/** e) Browser on any device: a laptop and a phone frame drawn in CSS. */
export function Devices({ copy, d }: { copy: LandingCopy['devices']; d: DeviceSample }) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-10 lg:gap-16 items-center">
      <div>
        <SectionHead eyebrow={copy.eyebrow} title={copy.title} desc={copy.desc} />
        <HairlineList items={copy.points} />
      </div>
      <div className="relative pb-6 sm:pb-0" aria-hidden="true">
        <figure className="me-0 sm:me-24">
          <div className="rounded-t-lg border border-line-strong bg-elevated p-2">
            <div className="flex items-center gap-1.5 px-1 pb-2">
              <span className="w-2 h-2 rounded-full bg-line-strong" />
              <span className="w-2 h-2 rounded-full bg-line-strong" />
              <span className="w-2 h-2 rounded-full bg-line-strong" />
              <span className="ms-2 text-fg-3 text-xs">{copy.laptopLabel}</span>
            </div>
            <div className="rounded-md border border-line bg-surface">
              <Screen copy={copy} d={d} />
            </div>
          </div>
          <div className="h-3 -mx-4 rounded-b-lg border border-t-0 border-line-strong bg-elevated" />
        </figure>
        <figure className="mx-auto mt-6 sm:mt-0 sm:absolute sm:bottom-0 sm:end-0 w-44 rounded-lg border-2 border-line-strong bg-elevated p-1.5">
          <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-line-strong" />
          <div className="rounded-md border border-line bg-surface">
            <Screen copy={copy} d={d} compact />
          </div>
          <p className="mt-1 text-center text-fg-3 text-xs">{copy.phoneLabel}</p>
        </figure>
      </div>
    </div>
  )
}
