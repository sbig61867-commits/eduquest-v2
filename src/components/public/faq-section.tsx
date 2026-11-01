'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FAQ_SECTION } from './anchors'
import { faqCategories, matchesQuery, type FaqCopy, type FaqEntry } from './faq-data'
import type { Lang } from './shell'
import { WRAP } from './ui'
import { localizedPath } from '@/i18n/public-routes'

// Home page FAQ (#faq, linked from the header). Start side: title, intro,
// search across every answer, the topics as tabs (a chip bar on phones) and a
// link to /contact. End side: the selected topic's questions as native
// <details> separated by hairlines. #faq-<slug> opens its question. Token
// classes only; copy in public.landing.faq, helpers in faq-data.ts.

type OpenSet = ReadonlySet<string>

function withItem(prev: OpenSet, id: string, on: boolean): OpenSet {
  if (prev.has(id) === on) return prev
  const next = new Set(prev)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

function FaqList({ items, open, onToggle, copied, onCopy, copyLabel, copiedLabel }: {
  items: FaqEntry[]
  open: OpenSet
  onToggle: (id: string, on: boolean) => void
  copied: string | null
  onCopy: (id: string) => void
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <div className="border-y border-line divide-y divide-line">
      {items.map(it => (
        <details
          key={it.id}
          id={it.id}
          open={open.has(it.id)}
          onToggle={e => onToggle(it.id, e.currentTarget.open)}
          className="group scroll-mt-24"
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-4 sm:py-6 text-start [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus rounded-control">
            <span className="text-fg text-base sm:text-lg font-semibold leading-relaxed transition-colors group-hover:text-accent">{it.q}</span>
            <span aria-hidden="true" className="relative mt-2 h-3.5 w-3.5 shrink-0 text-fg-3 transition-colors group-open:text-accent">
              <span className="absolute inset-0 m-auto h-0.5 w-full bg-current" />
              <span className="absolute inset-0 m-auto h-full w-0.5 bg-current transition-transform duration-200 motion-reduce:transition-none group-open:rotate-90" />
            </span>
          </summary>
          <div className="pb-6 pe-8 sm:pe-12">
            <p className="max-w-3xl text-fg-2 leading-loose">{it.a}</p>
            <button
              type="button"
              onClick={() => onCopy(it.id)}
              aria-live="polite"
              className="mt-3 text-fg-3 hover:text-accent text-meta font-medium transition-colors"
            >
              {copied === it.id ? copiedLabel : copyLabel}
            </button>
          </div>
        </details>
      ))}
    </div>
  )
}

export function FaqSection({ copy, lang }: { copy: FaqCopy; lang: Lang }) {
  const t = useTranslations('public.landing.faq')
  const cats = useMemo(() => faqCategories(copy), [copy])
  const [active, setActive] = useState(() => cats[0]?.key ?? '')
  const [open, setOpen] = useState<OpenSet>(() => new Set(cats[0]?.items[0] ? [cats[0].items[0].id] : []))
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const tablistRef = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef<string | null>(null)

  const searching = query.trim().length > 0
  const shown = useMemo(
    () => cats.map(c => ({ ...c, items: searching ? c.items.filter(it => matchesQuery(it, query)) : c.items })),
    [cats, query, searching],
  )
  const total = shown.reduce((n, c) => n + c.items.length, 0)

  const toggle = (id: string, on: boolean) => setOpen(prev => withItem(prev, id, on))

  const select = (key: string, focus = false) => {
    const cat = cats.find(c => c.key === key)
    if (!cat) return
    setActive(key)
    setQuery('')
    // A topic opens on its first question unless one of its questions is already open.
    if (cat.items[0] && !cat.items.some(it => open.has(it.id))) toggle(cat.items[0].id, true)
    if (focus) tabRefs.current[key]?.focus()
  }

  const search = (value: string) => {
    setQuery(value)
    const first = cats.flatMap(c => c.items).find(it => value.trim() && matchesQuery(it, value))
    if (first) toggle(first.id, true)
  }

  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const n = cats.length
    let next: number
    switch (e.key) {
      case 'ArrowDown': next = index + 1; break
      case 'ArrowUp': next = index - 1; break
      case 'ArrowRight': next = rtl ? index - 1 : index + 1; break
      case 'ArrowLeft': next = rtl ? index + 1 : index - 1; break
      case 'Home': next = 0; break
      case 'End': next = n - 1; break
      default: return
    }
    e.preventDefault()
    select(cats[(next + n) % n].key, true)
  }

  // A shared link (#faq-<slug>) opens its topic and question, on load and on a later hash change.
  useEffect(() => {
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      const cat = cats.find(c => c.items.some(it => it.id === id))
      if (!cat) return
      pendingScroll.current = id
      setQuery('')
      setActive(cat.key)
      setOpen(prev => withItem(prev, id, true))
    }
    const timer = window.setTimeout(openFromHash, 0)
    window.addEventListener('hashchange', openFromHash)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('hashchange', openFromHash)
    }
  }, [cats])

  // On phones the topics are a scrolling chip bar: keep the selected chip in view.
  useEffect(() => {
    const list = tablistRef.current
    const tab = tabRefs.current[active]
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return
    const l = list.getBoundingClientRect()
    const r = tab.getBoundingClientRect()
    if (r.left < l.left) list.scrollLeft -= l.left - r.left + 16
    else if (r.right > l.right) list.scrollLeft += r.right - l.right + 16
  }, [active])

  // After the render that revealed a linked question, bring it into view.
  useEffect(() => {
    const id = pendingScroll.current
    if (!id) return
    pendingScroll.current = null
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  })

  const copyLink = async (id: string) => {
    window.history.replaceState(null, '', `#${id}`)
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#${id}`)
      setCopied(id)
      window.setTimeout(() => setCopied(cur => (cur === id ? null : cur)), 2000)
    } catch {
      // Clipboard refused (insecure context): the address bar already holds the link.
    }
  }

  const list = (items: FaqEntry[]) => (
    <FaqList items={items} open={open} onToggle={toggle} copied={copied} onCopy={copyLink} copyLabel={copy.copyLink} copiedLabel={copy.copied} />
  )

  return (
    <section id={FAQ_SECTION} className={`scroll-mt-24 eq-pub-band ${WRAP} py-16 sm:py-20`}>
      <div className="eq-faq grid items-start gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-x-16 lg:gap-y-10">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-4xl font-bold text-fg leading-snug">{copy.title}</h2>
          <p className="mt-4 text-fg-2 leading-relaxed">{copy.intro}</p>

          <label className="mt-8 block">
            <span className="sr-only">{copy.searchLabel}</span>
            <input
              type="search"
              value={query}
              onChange={e => search(e.target.value)}
              placeholder={copy.searchPlaceholder}
              className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm text-fg placeholder:text-fg-3 transition-colors focus:outline-none focus:border-accent"
            />
          </label>
          <p className="sr-only" aria-live="polite">{searching ? t('resultCount', { count: total }) : ''}</p>

          <div
            ref={tablistRef}
            role="tablist"
            aria-label={copy.categoriesLabel}
            className="mt-6 -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-s lg:border-line lg:px-0 lg:pb-0"
          >
            {shown.map((c, i) => {
              const on = !searching && c.key === active
              const count = c.items.length
              return (
                <button
                  key={c.key}
                  ref={el => { tabRefs.current[c.key] = el }}
                  type="button"
                  role="tab"
                  id={`faq-tab-${c.key}`}
                  aria-selected={on}
                  aria-controls={`faq-panel-${c.key}`}
                  tabIndex={c.key === active ? 0 : -1}
                  onClick={() => select(c.key)}
                  onKeyDown={e => onTabKey(e, i)}
                  className={`flex shrink-0 items-center justify-between gap-3 rounded-full px-4 py-2 text-sm ring-1 ring-inset transition-colors lg:-ms-px lg:w-full lg:rounded-none lg:border-s-2 lg:bg-transparent lg:ps-4 lg:pe-0 lg:py-3 lg:text-start lg:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                    on
                      ? 'bg-accent-subtle text-fg font-semibold ring-accent lg:border-accent'
                      : `text-fg-2 ring-line hover:text-fg hover:ring-line-strong lg:border-transparent ${searching && count === 0 ? 'opacity-60' : ''}`
                  }`}
                >
                  <span>{c.title}</span>
                  <span className="num text-meta text-fg-3">{count}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="min-w-0 lg:row-span-2">
          {searching ? (
            <div role="region" aria-label={copy.resultsTitle}>
              <p className="mb-4 text-fg-3 text-sm">{t('resultCount', { count: total })}</p>
              {total === 0 ? (
                <p className="border-y border-line py-6 text-fg-2 leading-relaxed">{copy.noResults}</p>
              ) : (
                shown.filter(c => c.items.length > 0).map(c => (
                  <div key={c.key} className="mb-8 last:mb-0">
                    <h3 className="mb-2 text-fg-3 text-sm font-semibold">{c.title}</h3>
                    {list(c.items)}
                  </div>
                ))
              )}
            </div>
          ) : (
            cats.map(c => (
              <div
                key={c.key}
                role="tabpanel"
                id={`faq-panel-${c.key}`}
                aria-labelledby={`faq-tab-${c.key}`}
                hidden={c.key !== active}
              >
                {list(c.items)}
              </div>
            ))
          )}
        </div>

        <p className="text-fg-2 text-sm leading-relaxed lg:col-start-1 lg:row-start-2">
          {copy.moreTitle}{' '}
          <Link href={localizedPath(lang, '/contact')} className="font-semibold text-accent underline-offset-4 hover:text-accent-hover hover:underline">
            {copy.moreLink}
          </Link>
        </p>
      </div>
    </section>
  )
}
