'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { getRoleLabel } from '@/lib/utils'
import { getStudentTrack } from '@/lib/student-track'
import { Menu, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { NotificationBell } from './notification-bell'
import { LocaleSwitcher } from './locale-switcher'
import { ThemeToggle } from '@/components/public/theme-toggle'
import { AccountPanel } from './account-panel'
import { Modal } from '@/components/ui/modal'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { breadcrumbFor, type ResolvedNav } from '@/lib/navigation'
import { getTerms } from '@/lib/terminology'

interface HeaderProps {
  /** Role navigation (src/lib/navigation.ts): the header shows where the page
   *  sits — role / group / page — never a fixed page title. */
  nav?: ResolvedNav
  /** No longer rendered; the page's own heading names the page. */
  title?: string
}

export function Header({ nav }: HeaderProps) {
  const t = useTranslations('common')
  const locale = useLocale() as Locale
  const { user, tenant } = useAuthStore()
  const { setMobileNavOpen, breadcrumbDetail } = useUIStore()
  const pathname = usePathname()
  const tNav = useTranslations('common.nav')
  const tAccount = useTranslations('common.account')
  const [menuOpen, setMenuOpen] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // ?welcome=1 is set right after registration (join form, first password
  // change): greet the new account once with its details and member ID.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('welcome') !== '1') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL on mount
    setWelcome(true)
    params.delete('welcome')
    const rest = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menuOpen])

  const roleLabel = user?.role === 'student' && getStudentTrack(user.is_university_student, tenant?.has_center) === 'centre'
    ? t('centreTrainee')
    : user?.role ? getRoleLabel(user.role, tenant?.institution_type, locale) : ''

  const terms = getTerms(tenant?.institution_type, locale)
  const crumb = nav ? breadcrumbFor(nav, pathname) : null
  const itemLabel = crumb?.item ? (crumb.item.term ? terms[crumb.item.term] : crumb.item.label) : ''
  // A detail page (…/[id]) may name itself; otherwise the trail ends at its section.
  const detail = crumb?.deeper ? breadcrumbDetail : []
  const sep = <ChevronLeft className="w-3.5 h-3.5 shrink-0 text-fg-3 ltr:rotate-180" aria-hidden="true" />

  return (
    <>
    <header className="sticky top-0 h-16 bg-canvas border-b border-line flex items-center justify-between gap-3 px-4 lg:px-6 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="eq-focus lg:hidden p-2 rounded-control text-fg-3 hover:text-fg hover:bg-elevated transition-colors"
          aria-label={t('nav.openMenu')}
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        {crumb?.item && (
          <nav aria-label={tNav('breadcrumb')} className="min-w-0">
            <ol className="flex items-center gap-1.5 min-w-0 text-body-sm">
              {roleLabel && (
                <li className="hidden md:flex items-center gap-1.5 shrink-0">
                  <Link href={nav!.home.href} className="eq-focus rounded-control text-fg-3 hover:text-fg">{roleLabel}</Link>
                  {sep}
                </li>
              )}
              {crumb.group && (
                <li className="hidden sm:flex items-center gap-1.5 shrink-0 text-fg-3">
                  <span>{crumb.group.label}</span>
                  {sep}
                </li>
              )}
              <li className="flex items-center gap-1.5 min-w-0">
                {crumb.deeper
                  ? <Link href={crumb.item.href} className="eq-focus rounded-control text-fg-3 hover:text-fg truncate">{itemLabel}</Link>
                  : <span aria-current="page" className="text-fg font-medium truncate">{itemLabel}</span>}
              </li>
              {detail.map((part, i) => (
                <li key={i} className="flex items-center gap-1.5 min-w-0">
                  {sep}
                  <span aria-current={i === detail.length - 1 ? 'page' : undefined} className={cn('truncate', i === detail.length - 1 ? 'text-fg font-medium' : 'text-fg-3')}>{part}</span>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>

      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <ThemeToggle className="hidden sm:flex" />
        <LocaleSwitcher />
        <NotificationBell />

        <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          aria-expanded={menuOpen}
          aria-label={tAccount('open')}
          className="eq-focus flex items-center gap-3 rounded-control p-1 -m-1 hover:bg-elevated transition-colors text-start"
        >
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
            <span className="text-accent-fg text-body-sm font-semibold">
              {user?.full_name?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="hidden sm:block">
            <p className="text-fg text-body-sm font-medium leading-none">{user?.full_name ?? 'User'}</p>
            <p className="text-fg-3 text-label mt-1">{roleLabel}</p>
          </div>
        </button>
        {menuOpen && user && (
          <div role="dialog" aria-label={tAccount('title')}
            className="absolute top-full mt-2 end-0 w-80 max-w-[calc(100vw-2rem)] rounded-overlay border border-line-strong bg-surface p-4 shadow-overlay z-50">
            <p className="text-fg text-h3 mb-3">{tAccount('title')}</p>
            <AccountPanel user={user} tenant={tenant} />
          </div>
        )}
        </div>
      </div>
    </header>
    {/* Outside <header>, so the modal never inherits the header's stacking context. */}
    {user && (
      <Modal open={welcome} onClose={() => setWelcome(false)} title={tAccount('welcomeTitle')}>
        <p className="text-fg-3 text-body-sm mb-4">{tAccount('welcomeBody')}</p>
        <AccountPanel user={user} tenant={tenant} />
        <button type="button" onClick={() => setWelcome(false)}
          className="eq-focus mt-5 w-full py-2.5 rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-body-sm font-semibold">
          {tAccount('close')}
        </button>
      </Modal>
    )}
    </>
  )
}
