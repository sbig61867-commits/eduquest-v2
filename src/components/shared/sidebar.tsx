'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { AdaptiveName } from './adaptive-name'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { signOutAndLeave } from '@/lib/sign-out'
import { BrandMark } from './brand-mark'
import { BrandIntro } from './brand-intro'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getTerms, type Terms } from '@/lib/terminology'
import { activeHref, type IconName, type NavItem, type ResolvedNav } from '@/lib/navigation'
import { APP_NAME } from '@/lib/brand'
import {
  LogOut, ChevronLeft, X,
  LayoutDashboard, Building2, Users, Settings, Flag, ShieldCheck,
  GraduationCap, BookOpen, ClipboardList, ClipboardCheck, Activity, BarChart2, Bell, Mail, Layers, Inbox, Archive, CalendarDays, Gavel, Network, Sparkles,
  FileText, Megaphone, UserCog, ScanEye, ScrollText, CircleUser,
} from 'lucide-react'

const ICONS: Record<IconName, typeof LayoutDashboard> = {
  LayoutDashboard, Building2, Users, Settings, Flag, ShieldCheck, GraduationCap, BookOpen,
  ClipboardList, ClipboardCheck, Activity, BarChart2, Bell, Mail, Layers, Inbox, Archive,
  CalendarDays, Gavel, Network, Sparkles, FileText, Megaphone, UserCog, ScanEye, ScrollText, CircleUser,
}

export type { IconName, NavItem }

interface SidebarProps {
  /** Grouped navigation from src/lib/navigation.ts (role layouts). */
  nav?: ResolvedNav
  /** Flat list, ungrouped — kept for callers that pass items directly. */
  items?: NavItem[]
  // title / titleTerm / centreTraineeTitle are still accepted from callers,
  // but the role shows only in the header: the sidebar top is the platform
  // brand with the institution beneath it.
  title?: string
  titleTerm?: keyof Terms
  centreTraineeTitle?: string
}

export function Sidebar({ nav, items = [] }: SidebarProps) {
  const t = useTranslations('common.actions')
  const tNav = useTranslations('common.nav')
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const router = useRouter()
  const { sidebarOpen, toggleSidebar, restoreSidebar, mobileNavOpen, setMobileNavOpen } = useUIStore()
  const { tenant } = useAuthStore()
  const terms = getTerms(tenant?.institution_type, locale)
  const [signingOut, setSigningOut] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const expanded = sidebarOpen || mobileNavOpen

  useEffect(() => { restoreSidebar() }, [restoreSidebar])

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileNavOpen(false) }, [pathname, setMobileNavOpen])

  // Mobile drawer: focus moves in on open, Esc closes, Tab stays inside, and
  // focus returns to whatever opened it (the header menu button).
  useEffect(() => {
    if (!mobileNavOpen) return
    returnFocus.current = document.activeElement as HTMLElement | null
    const aside = asideRef.current
    const focusables = () => Array.from(aside?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
      .filter(el => el.offsetParent !== null)
    focusables()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMobileNavOpen(false); return }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) return
      const first = list[0], last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnFocus.current?.focus?.()
    }
  }, [mobileNavOpen, setMobileNavOpen])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    // Server-side cookie removal + a full page load; see src/lib/sign-out.ts.
    await signOutAndLeave('/login')
  }

  const visible = (item: NavItem) =>
    (!item.academicOnly || tenant?.structure_mode === 'academic') &&
    (!item.centerOnly || tenant?.has_center !== false)

  const sections: { key: string; label: string | null; items: NavItem[] }[] = nav
    ? [{ key: '_home', label: null as string | null, items: [nav.home] }, ...nav.groups]
        .map(g => ({ key: g.key, label: g.label, items: g.items.filter(visible) }))
        .filter(g => g.items.length > 0)
    : [{ key: '_flat', label: null, items: items.filter(visible) }]

  const current = activeHref(pathname, sections.flatMap(s => s.items.map(i => i.href)))

  const renderItem = (item: NavItem) => {
    const Icon = ICONS[item.icon]
    const label = item.term ? terms[item.term] : item.label
    const isActive = item.href === current
    // Prefetch on intent, not on sight (Batch 5, PERFORMANCE_CONTRACT.md P11): the
    // default prefetched every sidebar link on every full page load — two requests
    // per link (route tree + segments up to loading.tsx), 17 for a student and ~30
    // for an admin, each a proxy + function invocation that only carried the
    // loading skeleton. Hover, keyboard focus or a touch now prefetch that one link
    // (the router's segment cache dedupes repeats); a click without either still
    // navigates normally.
    const prefetch = () => router.prefetch(item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        onTouchStart={prefetch}
        aria-current={isActive ? 'page' : undefined}
        // Collapsed: icon only — the label stays the accessible name and the tooltip.
        aria-label={expanded ? undefined : label}
        title={expanded ? undefined : label}
        className={cn(
          'eq-focus relative flex items-center gap-3 px-3 py-2 rounded-control w-full transition-colors duration-150',
          // Active: a 2px line at the inline start + full-strength text.
          isActive
            ? 'text-fg bg-elevated before:absolute before:inset-y-1 before:start-0 before:w-0.5 before:bg-accent'
            : 'text-fg-3 hover:text-fg hover:bg-elevated',
        )}
      >
        <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
        {expanded && <span className="text-body-sm font-medium truncate">{label}</span>}
      </Link>
    )
  }

  return (
    <>
      {/* Outside <aside>: its translate transform would contain a fixed overlay. */}
      <BrandIntro />
      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-canvas/70 z-40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside ref={asideRef} className={cn(
        'fixed start-0 top-0 h-full bg-surface border-e border-line flex flex-col transition-[width,transform] duration-200 z-50',
        // Mobile: off-canvas drawer, always full width when open. The hidden
        // transform is scoped with max-lg: rather than overridden by a later
        // lg:translate-x-0 — `rtl:` and `lg:` are both single-variant utilities,
        // so which one wins is decided by Tailwind's CSS order, not by the order
        // they appear here, and rtl: was winning at every width (sidebar sat
        // entirely off-screen on desktop). Scoping it to max-lg: removes the
        // conflict instead of trying to out-specify it.
        //
        // rtl:translate-x-full because the drawer sits at the inline start,
        // which is the RIGHT edge under dir=rtl — hiding it means pushing it
        // further right, not left. max-lg:invisible keeps the hidden drawer's
        // links out of the tab order.
        'w-64',
        mobileNavOpen ? 'translate-x-0' : 'max-lg:-translate-x-full max-lg:rtl:translate-x-full max-lg:invisible',
        sidebarOpen ? 'lg:w-64' : 'lg:w-16'
      )}>
        <div className="flex items-center justify-between px-3 border-b border-line h-16">
          {expanded && (
            // The logo is a fixed mark: [T] Tilmoo in both languages. The
            // institution name under it keeps its own direction (dir=auto) but
            // lines up with the wordmark. Flat colour in the app shell (D4);
            // the gradient wordmark stays on the sign-in intro and public pages.
            // data-brand-anchor: where the sign-in intro lands the mark.
            <div dir="ltr" className="eq-brand flex items-center gap-2 overflow-hidden ps-1">
              <span data-brand-anchor className="shrink-0"><BrandMark size={32} className="block" /></span>
              <div className="min-w-0">
                <p className="text-fg text-body-sm font-semibold tracking-tight leading-none">{APP_NAME}</p>
                {tenant?.name && (
                  <p dir="auto" className="text-fg-3 text-label mt-1 text-left"><AdaptiveName name={tenant.name} max={26} /></p>
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? tNav('collapseSidebar') : tNav('expandSidebar')}
            title={sidebarOpen ? tNav('collapseSidebar') : tNav('expandSidebar')}
            aria-expanded={sidebarOpen}
            className="eq-focus hidden lg:flex items-center justify-center w-8 h-8 rounded-control text-fg-3 hover:text-fg hover:bg-elevated transition-colors ms-auto"
          >
            <ChevronLeft className={cn('w-4 h-4 rtl:-scale-x-100', !sidebarOpen && 'rotate-180')} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label={tNav('closeMenu')}
            className="eq-focus lg:hidden flex items-center justify-center w-8 h-8 rounded-control text-fg-3 hover:text-fg hover:bg-elevated transition-colors ms-auto"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label={tNav('mainNav')} className="flex-1 px-3 py-3 overflow-y-auto">
          {sections.map((section, i) => (
            <div key={section.key} className={cn(i > 0 && 'mt-4')}>
              {section.label && (expanded
                ? <p className="px-3 pb-1 text-label text-fg-3">{section.label}</p>
                : <div className="mx-2 mb-2 border-t border-line" aria-hidden="true" />)}
              <div className="space-y-0.5">{section.items.map(renderItem)}</div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-line">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label={expanded ? undefined : t('signOut')}
            title={expanded ? undefined : t('signOut')}
            className="eq-focus flex items-center gap-3 px-3 py-2 rounded-control text-fg-3 hover:text-danger hover:bg-danger-subtle transition-colors w-full disabled:opacity-50"
          >
            <LogOut className="w-5 h-5 shrink-0" aria-hidden="true" />
            {expanded && <span className="text-body-sm font-medium">{signingOut ? t('signingOut') : t('signOut')}</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
