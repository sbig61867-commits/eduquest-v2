'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { getRoleLabel } from '@/lib/utils'
import { getStudentTrack, CENTRE_TRAINEE_LABEL } from '@/lib/student-track'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { NotificationBell } from './notification-bell'
import { LocaleSwitcher } from './locale-switcher'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const t = useTranslations('common')
  const locale = useLocale() as Locale
  const { user, tenant } = useAuthStore()
  const { sidebarOpen, setMobileNavOpen } = useUIStore()

  return (
    <header className={cn(
      'fixed top-0 end-0 start-0 h-16 bg-slate-950/80 backdrop-blur border-b border-slate-800 flex items-center justify-between px-4 lg:px-6 z-30 transition-all duration-300',
      sidebarOpen ? 'lg:start-64' : 'lg:start-16'
    )}>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMobileNavOpen(true)}
          className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label={t('nav.openMenu')}
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-white font-semibold text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Hidden on the narrowest phones, where the header has no room; the
            profile page carries the same switcher for that case. */}
        <LocaleSwitcher className="hidden sm:flex" />
        <NotificationBell />

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">
              {user?.full_name?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="hidden sm:block">
            <p className="text-white text-sm font-medium leading-none">{user?.full_name ?? 'User'}</p>
            <p className="text-slate-400 text-xs mt-0.5">
              {user?.role === 'student' && getStudentTrack(user.is_university_student, tenant?.has_center) === 'centre'
                ? CENTRE_TRAINEE_LABEL
                : user?.role ? getRoleLabel(user.role, tenant?.institution_type, locale) : ''}
              {tenant?.name && (
                <span className="text-slate-500"> · {tenant.name}</span>
              )}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}
