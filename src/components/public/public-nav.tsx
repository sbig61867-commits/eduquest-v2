'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { LOCALES, LOCALE_LABEL, type Locale } from '@/i18n/config'
import { isMarketingPath, localizedPath, type MarketingPath } from '@/i18n/public-routes'
import { pricingEnabled } from '@/lib/pricing/plans'
import { FAQ_SECTION, FEATURE_ANCHORS, ROLE_ANCHORS, ROLES_SECTION, roleAnchorId } from './anchors'

// Header of the public pages: a mega-menu per section, in the spirit of large
// product sites. Each trigger opens one wide panel (heading + overview link on
// one side, the section's links with a short description on the other).
//
// Behaviour
//   open      hover on desktop (a mouse click then keeps it open), tap or
//             Enter/Space toggles, ArrowDown moves focus into the panel,
//             Escape closes and returns focus.
//   scroll    scrolling down slides the bar away so it does not cover the
//             page; scrolling up, moving the mouse into the top edge of the
//             window, or tabbing into it brings it back. It never hides while
//             a menu is open.
//   mobile    one "Menu" button opens every section as a full-width sheet.
//
// No icons by design (see public-copy-style.test.ts for the copy rules).

type MenuKey = 'platform' | 'audience' | 'resources' | 'contact'
type Target = { path: MarketingPath | '/demo' | '/login'; hash?: string }
type MenuDef = { key: MenuKey; overview: Target; items: { key: string; to: Target }[] }

const MENUS: MenuDef[] = [
  {
    key: 'platform',
    overview: { path: '/features' },
    items: FEATURE_ANCHORS.map(a => ({ key: a, to: { path: '/features', hash: a } })),
  },
  {
    key: 'audience',
    overview: { path: '/features', hash: ROLES_SECTION },
    items: ROLE_ANCHORS.map(r => ({ key: r, to: { path: '/features', hash: roleAnchorId(r) } })),
  },
  {
    key: 'resources',
    overview: { path: '/demo' },
    items: [
      { key: 'demo', to: { path: '/demo' } },
      { key: 'faq', to: { path: '/', hash: FAQ_SECTION } },
      { key: 'privacy', to: { path: '/privacy' } },
      { key: 'terms', to: { path: '/terms' } },
    ],
  },
  {
    key: 'contact',
    overview: { path: '/contact' },
    items: [
      { key: 'subscribe', to: { path: '/contact' } },
      { key: 'question', to: { path: '/contact' } },
      { key: 'login', to: { path: '/login' } },
    ],
  },
]

/** Pixels from the top edge of the window that bring a hidden bar back. */
const REVEAL_ZONE = 72
/** Scroll distance before the bar reacts, so trackpad jitter does nothing. */
const SCROLL_SLACK = 6
/** Always visible this close to the top of the page. */
const TOP_ZONE = 80
/** Grace period for moving the pointer from a trigger into its panel. */
const CLOSE_DELAY = 160

function hrefFor(lang: Locale, to: Target): string {
  const base = isMarketingPath(to.path) ? localizedPath(lang, to.path) : to.path
  return to.hash ? `${base}#${to.hash}` : base
}

export function PublicNav({ lang, setLang }: { lang: Locale; setLang: (l: Locale) => void }) {
  const t = useTranslations('public.shell')
  const m = useTranslations('public.shell.menu')
  const other = LOCALES.find(l => l !== lang) ?? lang

  const [open, setOpen] = useState<MenuKey | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolledAway, setScrolledAway] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  const panelId = useId()
  const closeTimer = useRef<number | undefined>(undefined)
  const triggers = useRef<Partial<Record<MenuKey, HTMLButtonElement | null>>>({})
  const panelRef = useRef<HTMLDivElement>(null)
  // Pointer type of the press that led to the current click. A mouse user has
  // already opened the menu by hovering, so their click must not toggle it
  // shut again; touch and keyboard (no pointer press) keep toggle behaviour.
  const pressPointer = useRef<string>('')

  const cancelClose = useCallback(() => window.clearTimeout(closeTimer.current), [])
  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(null), CLOSE_DELAY)
  }, [])

  const closeAll = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    setOpen(null)
    setMobileOpen(false)
  }, [])

  // Hide on scroll down, show on scroll up / near the top / pointer at the top edge.
  useEffect(() => {
    let lastY = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 8)
      const goingDown = y - lastY > SCROLL_SLACK
      const goingUp = lastY - y > SCROLL_SLACK
      if (y < TOP_ZONE || goingUp) setScrolledAway(false)
      else if (goingDown) {
        setScrolledAway(true)
        setOpen(null)
      }
      if (Math.abs(y - lastY) > SCROLL_SLACK) lastY = y
    }
    const onPointer = (e: MouseEvent) => {
      if (e.clientY <= REVEAL_ZONE) setScrolledAway(false)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('mousemove', onPointer, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('mousemove', onPointer)
      window.clearTimeout(closeTimer.current)
    }
  }, [])

  // Escape closes whatever is open and hands focus back to its trigger.
  useEffect(() => {
    if (!open && !mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const back = open ? triggers.current[open] : null
      closeAll()
      back?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, mobileOpen, closeAll])

  // The mobile sheet covers the page, so the page behind it must not scroll.
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  const hidden = scrolledAway && !open && !mobileOpen
  const active = MENUS.find(menu => menu.key === open)

  function onTriggerKey(e: React.KeyboardEvent, key: MenuKey) {
    if (e.key !== 'ArrowDown') return
    e.preventDefault()
    setOpen(key)
    // Focus the first link once the panel has rendered.
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus())
  }

  return (
    <>
      {/* Dims the page under an open panel; clicking it closes the menu. */}
      <div
        aria-hidden="true"
        onClick={closeAll}
        className={`fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none ${
          open || mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <header
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onFocusCapture={() => setScrolledAway(false)}
        className={`sticky top-0 z-40 border-b transition-[transform,opacity,background-color,border-color] duration-300 ease-out motion-reduce:transition-none ${
          hidden ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'
        } ${
          scrolled || open || mobileOpen
            ? 'bg-slate-950/90 backdrop-blur-md border-slate-800'
            : 'bg-slate-950 border-transparent'
        }`}
      >
        <nav aria-label={m('navLabel')} className="relative max-w-6xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 lg:gap-8 min-w-0">
            <Link href={localizedPath(lang, '/')} onClick={closeAll} className="flex items-center gap-2.5 shrink-0 px-1">
              <span className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg shrink-0">E</span>
              <span className="text-white font-bold text-lg hidden sm:inline">EduQuest</span>
            </Link>

            {/* Desktop triggers */}
            <ul className="hidden md:flex items-center gap-1">
              {MENUS.map(menu => {
                const isOpen = open === menu.key
                return (
                  <li key={menu.key}>
                    <button
                      ref={el => { triggers.current[menu.key] = el }}
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onMouseEnter={() => { cancelClose(); setOpen(menu.key) }}
                      onPointerDown={e => { pressPointer.current = e.pointerType }}
                      onClick={() => {
                        const byMouse = pressPointer.current === 'mouse'
                        pressPointer.current = ''
                        cancelClose()
                        setOpen(byMouse || !isOpen ? menu.key : null)
                      }}
                      onKeyDown={e => onTriggerKey(e, menu.key)}
                      className={`px-3.5 py-2 rounded-full text-sm transition-colors whitespace-nowrap ${
                        isOpen ? 'bg-slate-800 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      {m(`${menu.key}.label`)}
                    </button>
                  </li>
                )
              })}
              {pricingEnabled && (
                <li>
                  <Link
                    href={localizedPath(lang, '/pricing')}
                    onMouseEnter={scheduleClose}
                    className="px-3.5 py-2 rounded-full text-sm text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors whitespace-nowrap"
                  >
                    {t('pricing')}
                  </Link>
                </li>
              )}
            </ul>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setLang(other)}
              lang={other}
              aria-label={`${t('switchLanguage')}: ${LOCALE_LABEL[other]}`}
              className="px-2.5 py-2 rounded-full text-sm text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors whitespace-nowrap"
            >
              {LOCALE_LABEL[other]}
            </button>
            <Link
              href="/login"
              className="px-3 sm:px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors whitespace-nowrap"
            >
              {t('login')}
            </Link>
            <button
              type="button"
              aria-expanded={mobileOpen}
              aria-controls={`${panelId}-mobile`}
              onClick={() => { setOpen(null); setMobileOpen(v => !v) }}
              className="md:hidden px-3 py-2 rounded-full text-sm text-slate-200 border border-slate-700 hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              {mobileOpen ? m('close') : m('open')}
            </button>
          </div>
        </nav>

        {/* Desktop panel */}
        <div
          id={panelId}
          ref={panelRef}
          className={`absolute inset-x-0 top-full hidden md:block origin-top transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
            active ? 'visible opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <div className="bg-slate-900 border-b border-slate-800 shadow-2xl shadow-black/40 rounded-b-3xl">
            {active && (
              <div key={active.key} className="eq-menu-in max-w-6xl mx-auto px-6 py-10 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-10">
                <div>
                  <p className="text-2xl lg:text-3xl font-bold text-white leading-snug max-w-sm">{m(`${active.key}.heading`)}</p>
                  <Link
                    href={hrefFor(lang, active.overview)}
                    onClick={closeAll}
                    className="inline-flex mt-7 px-5 py-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium transition-colors"
                  >
                    {m(`${active.key}.overview`)}
                  </Link>
                </div>
                <div className="border-s border-slate-800 ps-10">
                  <p className="text-slate-500 text-sm mb-4 px-3">{m(`${active.key}.group`)}</p>
                  <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1">
                    {active.items.map(item => (
                      <li key={item.key}>
                        <Link
                          href={hrefFor(lang, item.to)}
                          onClick={closeAll}
                          className="block rounded-xl px-3 py-3 hover:bg-slate-800/70 focus-visible:bg-slate-800/70 outline-none transition-colors"
                        >
                          <span className="block text-slate-100 font-medium">{m(`${active.key}.items.${item.key}.title`)}</span>
                          <span className="block text-slate-400 text-sm mt-1 leading-relaxed">{m(`${active.key}.items.${item.key}.desc`)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile sheet */}
        <div
          id={`${panelId}-mobile`}
          className={`md:hidden absolute inset-x-0 top-full transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
            mobileOpen ? 'visible opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto bg-slate-900 border-b border-slate-800 shadow-2xl shadow-black/40 px-4 py-6 space-y-7">
            {MENUS.map(menu => (
              <section key={menu.key}>
                <p className="text-slate-500 text-sm mb-2 px-3">{m(`${menu.key}.label`)}</p>
                <ul>
                  {menu.items.map(item => (
                    <li key={item.key}>
                      <Link
                        href={hrefFor(lang, item.to)}
                        onClick={closeAll}
                        className="block rounded-xl px-3 py-2.5 hover:bg-slate-800/70 transition-colors"
                      >
                        <span className="block text-slate-100">{m(`${menu.key}.items.${item.key}.title`)}</span>
                        <span className="block text-slate-400 text-sm mt-0.5">{m(`${menu.key}.items.${item.key}.desc`)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {pricingEnabled && (
              <Link href={localizedPath(lang, '/pricing')} onClick={closeAll} className="block rounded-xl px-3 py-2.5 text-slate-100 hover:bg-slate-800/70">
                {t('pricing')}
              </Link>
            )}
          </div>
        </div>
      </header>
    </>
  )
}
