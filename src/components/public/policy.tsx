'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useLang, PublicNav, PublicFooter } from './shell'
import { CheckDot } from './ui'
import { localizedPath } from '@/i18n/public-routes'

// Policy centre (/privacy and /terms): one navigable component for the privacy
// policy, the terms of use, a security summary and the cookie policy (opened
// by #security / #cookies, e.g. from /legal). Documents are tabs, sections
// are <details> with a one line summary first, a client side filter narrows
// them, every section has an anchor and a copy-link button, and the side index
// follows the reading position (IntersectionObserver). All text comes from
// public.policy.*; the summaries and key points restate it.

type Section = { h: string; body: string[]; summary?: string }
type PolicyDoc = { title: string; updated: string; sections: Section[]; keyPoints: string[]; summaries?: string[] }
type CookieRowKey = 'session' | 'ctx' | 'locale' | 'theme' | 'join'
type CookieTable = {
  caption: string; name: string; purpose: string; lifetime: string; httpOnly: string; category: string
  yes: string; no: string; necessary: string; functional: string
  rows: Record<CookieRowKey, { purpose: string; lifetime: string }>
}
type Note = { title: string; body: string }
type Centre = {
  eyebrow: string; title: string; desc: string; docsLabel: string; indexLabel: string; searchLabel: string
  searchPlaceholder: string; noResults: string; keyPoints: string; summary: string; copyLink: string; copied: string; fullPage: string
}

const DOCS = ['privacy', 'terms', 'security', 'cookies'] as const
type DocKey = (typeof DOCS)[number]

const sectionId = (doc: DocKey, i: number) => `${doc}-${i + 1}`

// The cookies the platform actually sets (names are not translated). Sources:
// src/lib/auth/better.ts + proxy-session.ts (tm.session_token), src/lib/auth/session.ts
// (tm_ctx), src/i18n/config.ts (eq_locale), src/lib/theme.ts (eq_theme),
// src/lib/person-name.ts + join-form.tsx (eq_join_name).
export const COOKIE_ROWS: { key: CookieRowKey; name: string; httpOnly: boolean; necessary: boolean }[] = [
  { key: 'session', name: 'tm.session_token', httpOnly: true, necessary: true },
  { key: 'ctx', name: 'tm_ctx', httpOnly: true, necessary: true },
  { key: 'join', name: 'eq_join_name', httpOnly: false, necessary: true },
  { key: 'locale', name: 'eq_locale', httpOnly: false, necessary: false },
  { key: 'theme', name: 'eq_theme', httpOnly: false, necessary: false },
]

// #cookies opens a document, #cookies-2 one of its sections.
function docOfHash(hash: string): DocKey | null {
  const m = /^#(privacy|terms|security|cookies)(?:-\d+)?$/.exec(hash)
  return m ? (m[1] as DocKey) : null
}

export function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const [lang, setLang] = useLang()
  const t = useTranslations('public.policy')
  const c = t.raw('centre') as Centre
  const badges = t.raw('badges') as Record<DocKey, string>
  const note = t.raw('securityNote') as Note
  const table = t.raw('cookies.table') as CookieTable
  const docs = useMemo(() => {
    const withSummaries = (d: PolicyDoc): PolicyDoc => ({ ...d, sections: d.sections.map((s, i) => ({ ...s, summary: s.summary ?? d.summaries?.[i] })) })
    return Object.fromEntries(DOCS.map(k => [k, withSummaries(t.raw(k) as PolicyDoc)])) as Record<DocKey, PolicyDoc>
  }, [t])

  const [doc, setDoc] = useState<DocKey>(kind)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // A shared link (#terms-3) opens its document and section.
  useEffect(() => {
    const fromHash = docOfHash(window.location.hash)
    if (!fromHash) return
    const id = window.location.hash.slice(1)
    const timer = window.setTimeout(() => {
      setDoc(fromHash)
      if (id === fromHash) return
      setTarget(id)
      window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const d = docs[doc]
  const q = query.trim().toLowerCase()
  const shown = d.sections
    .map((s, i) => ({ s, i, id: sectionId(doc, i) }))
    .filter(({ s }) => !q || [s.h, s.summary ?? '', ...s.body].some(x => x.toLowerCase().includes(q)))

  // Scroll spy: the section nearest the top third of the viewport is current.
  const shownKey = shown.map(x => x.id).join(' ')
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const io = new IntersectionObserver(
      entries => {
        const hit = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: '-20% 0px -65% 0px' },
    )
    root.querySelectorAll('[data-policy-section]').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [shownKey])

  const pick = (k: DocKey) => {
    setDoc(k)
    setQuery('')
    setActive(null)
    setTarget(null)
    // Privacy and terms keep their own URL; the security summary and cookie policy use a hash.
    if (k === 'privacy' || k === 'terms') window.history.replaceState(null, '', localizedPath(lang, k === 'privacy' ? '/privacy' : '/terms'))
    else window.history.replaceState(null, '', `#${k}`)
  }

  const copyLink = async (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`
    window.history.replaceState(null, '', `#${id}`)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      window.setTimeout(() => setCopied(cur => (cur === id ? null : cur)), 2000)
    } catch {
      // Clipboard refused (insecure context): the address bar already holds the anchor.
    }
  }

  const chip = (on: boolean) =>
    `shrink-0 px-3 py-1.5 rounded-full border text-sm transition-colors ${on ? 'border-accent bg-accent-subtle text-fg' : 'border-line text-fg-2 hover:text-fg hover:border-line-strong'}`

  return (
    <div className="min-h-screen bg-canvas text-fg overflow-x-clip">
      <PublicNav lang={lang} setLang={setLang} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-14">
        <p className="text-accent text-sm font-semibold mb-3">{c.eyebrow}</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-fg">{c.title}</h1>
        <p className="text-fg-2 mt-3 max-w-3xl leading-relaxed">{c.desc}</p>

        <div role="tablist" aria-label={c.docsLabel} className="mt-8 flex gap-1 border-b border-line overflow-x-auto">
          {DOCS.map(k => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`tab-${k}`}
              aria-selected={k === doc}
              aria-controls="policy-panel"
              onClick={() => pick(k)}
              className={`shrink-0 px-4 py-3 -mb-px border-b-2 text-sm font-semibold transition-colors ${k === doc ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg'}`}
            >
              {docs[k].title}
            </button>
          ))}
        </div>

        <div className="mt-8 grid lg:grid-cols-[15rem_minmax(0,1fr)] gap-8 lg:gap-12">
          {/* Index: chips on small screens, a sticky list beside the text on large ones */}
          <nav aria-label={c.indexLabel} className="min-w-0">
            <div className="lg:sticky lg:top-24">
              <p className="hidden lg:block text-fg-3 text-xs font-semibold mb-3">{c.indexLabel}</p>
              <ul className="flex lg:flex-col gap-2 lg:gap-0 overflow-x-auto pb-2 lg:pb-0 lg:border-s lg:border-line">
                {shown.map(({ s, id }) => {
                  const on = active === id
                  return (
                    <li key={id} className="shrink-0">
                      <a
                        href={`#${id}`}
                        aria-current={on ? 'location' : undefined}
                        className={`lg:hidden ${chip(on)}`}
                      >
                        {s.h}
                      </a>
                      <a
                        href={`#${id}`}
                        aria-current={on ? 'location' : undefined}
                        className={`hidden lg:block -ms-px border-s-2 ps-4 py-2 text-sm transition-colors ${on ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-3 hover:text-fg'}`}
                      >
                        {s.h}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          </nav>

          <div id="policy-panel" role="tabpanel" aria-labelledby={`tab-${doc}`} className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span dir="ltr" className="rounded-full border border-line bg-surface px-3 py-1 text-fg-2 text-xs font-semibold">{badges[doc]}</span>
              <p className="text-fg-3 text-sm">{d.updated}</p>
            </div>

            {doc === 'security' && (
              <aside role="note" className="mt-4 rounded-lg border border-accent bg-accent-subtle p-4">
                <p className="text-fg text-sm font-semibold">{note.title}</p>
                <p className="text-fg-2 text-sm mt-1 leading-relaxed">{note.body}</p>
              </aside>
            )}

            <section aria-label={c.keyPoints} className="mt-4 rounded-lg border border-line bg-surface p-4 sm:p-6">
              <p className="text-fg-3 text-xs font-semibold mb-3">{c.keyPoints}</p>
              <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
                {d.keyPoints.map(k => (
                  <li key={k} className="flex gap-3 text-fg-2 text-sm leading-relaxed"><CheckDot tone="bg-accent" />{k}</li>
                ))}
              </ul>
            </section>

            {doc === 'cookies' && <CookieTableView table={table} />}

            <label className="mt-6 block">
              <span className="sr-only">{c.searchLabel}</span>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={c.searchPlaceholder}
                className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus:border-accent"
              />
            </label>

            <div ref={listRef} className="mt-4 border-t border-line divide-y divide-line">
              {shown.length === 0 && <p className="py-6 text-fg-3 text-sm">{c.noResults}</p>}
              {shown.map(({ s, id }) => (
                <details key={`${id}-${q ? 'q' : ''}`} id={id} data-policy-section open={!!q || target === id} className="group scroll-mt-24 py-2">
                  <summary className="flex cursor-pointer list-none items-start gap-3 py-3 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="mt-1.5 w-2 h-2 shrink-0 border-r-2 border-b-2 border-fg-3 -rotate-45 rtl:rotate-[135deg] transition-transform group-open:rotate-45 group-open:rtl:rotate-45" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-fg font-semibold">{s.h}</span>
                      {s.summary && <span className="block text-fg-2 text-sm mt-1 leading-relaxed">{s.summary}</span>}
                    </span>
                  </summary>
                  <div className="ps-5 pb-4">
                    <ul className="space-y-2">
                      {s.body.map(line => (
                        <li key={line} className="text-fg-2 text-sm leading-relaxed">{line}</li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => copyLink(id)} className="mt-3 text-accent hover:text-accent-hover text-xs font-semibold" aria-live="polite">
                      {copied === id ? c.copied : c.copyLink}
                    </button>
                  </div>
                </details>
              ))}
            </div>

            {doc === 'security' && (
              <Link href={localizedPath(lang, '/security')} className="inline-flex mt-6 text-accent hover:text-accent-hover text-sm font-semibold underline-offset-4 hover:underline">
                {c.fullPage}
              </Link>
            )}
          </div>
        </div>
      </main>
      <PublicFooter lang={lang} />
    </div>
  )
}

function CookieTableView({ table }: { table: CookieTable }) {
  const head = [table.name, table.purpose, table.lifetime, table.httpOnly, table.category]
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">{table.caption}</caption>
        <thead className="bg-surface">
          <tr>
            {head.map(h => (
              <th key={h} scope="col" className="px-4 py-3 text-start text-fg-3 text-xs font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {COOKIE_ROWS.map(row => (
            <tr key={row.key} className="align-top">
              <th scope="row" className="px-4 py-3 text-start text-fg text-xs font-semibold"><span dir="ltr">{row.name}</span></th>
              <td className="px-4 py-3 text-fg-2 leading-relaxed">{table.rows[row.key].purpose}</td>
              <td className="px-4 py-3 text-fg-2 leading-relaxed">{table.rows[row.key].lifetime}</td>
              <td className="px-4 py-3 text-fg-2">{row.httpOnly ? table.yes : table.no}</td>
              <td className="px-4 py-3 text-fg-2">{row.necessary ? table.necessary : table.functional}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
