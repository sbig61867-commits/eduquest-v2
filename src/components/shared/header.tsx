'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { getRoleLabel } from '@/lib/utils'
import { getStudentTrack } from '@/lib/student-track'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { NotificationBell } from './notification-bell'
import { LocaleSwitcher } from './locale-switcher'
import { AccountPanel } from './account-panel'
import { Modal } from '@/components/ui/modal'
import { useEffect, useRef, useState } from 'react'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const t = useTranslations('common')
  const locale = useLocale() as Locale
  const { user, tenant } = useAuthStore()
  const { sidebarOpen, setMobileNavOpen } = useUIStore()
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

  return (
    <>
    <header className={cn(
      'fixed top-0 end-0 start-0 h-16 bg-slate-950/80 backdrop-blur border-b border-slate-800 flex items-center justify-between px-4 lg:px-6 z-30 transition-all duration-300',
      sidebarOpen ? 'lg:start-64' : 'lg:start-16'
    )}>
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => setMobileNavOpen(true)}
          className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label={t('nav.openMenu')}
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-white font-semibold text-lg truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <LocaleSwitcher />
        <NotificationBell />

        <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          aria-expanded={menuOpen}
          aria-label={tAccount('open')}
          className="flex items-center gap-3 rounded-lg p-1 -m-1 hover:bg-slate-800/60 transition-colors text-start"
        >
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">
              {user?.full_name?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="hidden sm:block">
            <p className="text-white text-sm font-medium leading-none">{user?.full_name ?? 'User'}</p>
            <p className="text-slate-400 text-xs mt-0.5">
              {user?.role === 'student' && getStudentTrack(user.is_university_student, tenant?.has_center) === 'centre'
                ? t('centreTrainee')
                : user?.role ? getRoleLabel(user.role, tenant?.institution_type, locale) : ''}
            </p>
          </div>
        </button>
        {menuOpen && user && (
          <div role="dialog" aria-label={tAccount('title')}
            className="absolute top-full mt-2 end-0 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl z-50">
            <p className="text-white font-semibold mb-3">{tAccount('title')}</p>
            <AccountPanel user={user} tenant={tenant} />
          </div>
        )}
        </div>
      </div>
    </header>
    {/* Outside <header>: its backdrop-blur would contain a fixed overlay. */}
    {user && (
      <Modal open={welcome} onClose={() => setWelcome(false)} title={tAccount('welcomeTitle')}>
        <p className="text-slate-400 text-sm mb-4">{tAccount('welcomeBody')}</p>
        <AccountPanel user={user} tenant={tenant} />
        <button type="button" onClick={() => setWelcome(false)}
          className="mt-5 w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
          {tAccount('close')}
        </button>
      </Modal>
    )}
    </>
  )
}
