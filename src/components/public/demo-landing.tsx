'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import type enPublic from '@/messages/en/public.json'
import type { Locale } from '@/i18n/config'
import { localizedPath } from '@/i18n/public-routes'
import { getDemoData } from '@/lib/demo/data'
import { CtaBand, PANEL, PageHero, WRAP } from './ui'

// /demo entry: pick a role and start the tour. Each card previews that role's
// dashboard in CSS (its real menu, the fictional institution's name) and lists
// the pages the tour covers. The tour itself (/demo/<role>) is static fixtures
// only — no Supabase, no fetch (src/lib/demo/data.ts).
type DemoCopy = typeof enPublic.demo
type Role = 'admin' | 'teacher' | 'student' | 'center'
type NavKey = keyof DemoCopy['nav']

const ROLES: { key: Role; pages: NavKey[] }[] = [
  { key: 'admin', pages: ['dashboard', 'teachers', 'students', 'courses'] },
  { key: 'teacher', pages: ['dashboard', 'groups', 'exams'] },
  { key: 'student', pages: ['dashboard', 'courses', 'exams', 'grades'] },
  { key: 'center', pages: ['dashboard', 'schedules', 'announcements'] },
]

const ACCENT: Record<Role, { band: string; solid: string; soft: string; text: string; ring: string }> = {
  admin: { band: 'from-blue-600/30', solid: 'bg-blue-600', soft: 'bg-blue-500/15', text: 'text-blue-300', ring: 'hover:border-blue-500/50' },
  teacher: { band: 'from-violet-600/30', solid: 'bg-violet-600', soft: 'bg-violet-500/15', text: 'text-violet-300', ring: 'hover:border-violet-500/50' },
  student: { band: 'from-emerald-500/25', solid: 'bg-emerald-600', soft: 'bg-emerald-500/15', text: 'text-emerald-300', ring: 'hover:border-emerald-500/50' },
  center: { band: 'from-amber-500/25', solid: 'bg-amber-600', soft: 'bg-amber-500/15', text: 'text-amber-300', ring: 'hover:border-amber-500/50' },
}

/** A miniature of the role's dashboard: its real menu beside a content skeleton. */
function Preview({ role, menu, tenant }: { role: Role; menu: string[]; tenant: string }) {
  const a = ACCENT[role]
  return (
    <div aria-hidden="true" className={`relative px-5 pt-5 bg-gradient-to-b ${a.band} to-transparent`}>
      <div className="rounded-t-2xl border border-b-0 border-slate-700/60 bg-slate-900/95 overflow-hidden shadow-2xl">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-800">
          <span className="w-2 h-2 rounded-full bg-red-400/70" />
          <span className="w-2 h-2 rounded-full bg-amber-400/70" />
          <span className="w-2 h-2 rounded-full bg-emerald-400/70" />
          <span className="text-slate-500 text-[10px] ms-2 truncate">{tenant}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] h-40">
          <ul className="border-e border-slate-800 bg-slate-950/50 p-2 space-y-1">
            {menu.map((m, i) => (
              <li key={m} className={`px-2 py-1.5 rounded-md text-[10px] truncate ${i === 0 ? `${a.solid} text-on-accent` : 'text-slate-500'}`}>{m}</li>
            ))}
          </ul>
          <div className="p-3 space-y-2.5">
            <div className="grid grid-cols-3 gap-1.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-md border border-slate-800 bg-slate-950/60 p-1.5 space-y-1">
                  <span className="block h-1 w-2/3 rounded bg-slate-700" />
                  <span className={`block h-2 w-1/2 rounded ${a.soft}`} />
                </div>
              ))}
            </div>
            {[70, 55, 62].map((w, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-1.5">
                <span className={`w-4 h-4 rounded ${a.soft}`} />
                <span className="block h-1.5 rounded bg-slate-700" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DemoLanding() {
  const [lang, setLang] = useLang()
  const t = useTranslations('public.demo')
  const copy = useTranslations('public').raw('demo') as DemoCopy
  const tenant = getDemoData(useLocale() as Locale).tenant.name

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />
      <PageHero eyebrow={copy.landing.eyebrow} title={copy.landing.title} desc={copy.landing.desc} />

      {/* Roles */}
      <section className={`${WRAP} pb-16 sm:pb-20`}>
        <div className="grid md:grid-cols-2 gap-5">
          {ROLES.map(r => {
            const a = ACCENT[r.key]
            const menu = r.pages.map(p => t(`nav.${p}`))
            return (
              <article key={r.key} className={`group ${PANEL} overflow-hidden flex flex-col transition-colors ${a.ring}`}>
                <Preview role={r.key} menu={menu} tenant={tenant} />
                <div className="relative border-t border-slate-800 p-7 flex-1 flex flex-col">
                  <h2 className="text-white text-2xl font-bold">{t(`roles.${r.key}.label`)}</h2>
                  <p className="text-slate-400 mt-2 leading-relaxed">{t(`roles.${r.key}.desc`)}</p>
                  <p className="text-slate-500 text-xs font-semibold mt-6 mb-2.5">{copy.landing.pagesLabel}</p>
                  <ul className="flex flex-wrap gap-2">
                    {menu.map(m => (
                      <li key={m} className="px-3 py-1 rounded-full border border-slate-700 text-slate-300 text-xs">{m}</li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-7">
                    <Link
                      href={`/demo/${r.key}`}
                      className={`inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 rounded-xl ${a.solid} hover:opacity-90 text-on-accent font-semibold text-sm transition-opacity`}
                    >
                      {copy.landing.start}
                    </Link>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* What the demonstration is */}
      <section className={`${WRAP} py-12 sm:py-16`}>
        <ol className="grid md:grid-cols-3 gap-4">
          {copy.landing.notes.map((n, i) => (
            <li key={n.title} className={`${PANEL} p-6 flex gap-4`}>
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600/15 border border-blue-500/30 text-blue-300 font-bold shrink-0">{i + 1}</span>
              <div>
                <h3 className="text-white font-semibold">{n.title}</h3>
                <p className="text-slate-400 text-sm mt-1.5 leading-relaxed">{n.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <CtaBand
        title={copy.landing.cta.title}
        desc={copy.landing.cta.desc}
        primary={{ label: copy.landing.cta.primary, href: localizedPath(lang, '/contact') }}
        secondary={{ label: copy.landing.cta.secondary, href: localizedPath(lang, '/features') }}
      />

      <PublicFooter lang={lang} />
    </div>
  )
}
