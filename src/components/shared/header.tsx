'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NotificationBell } from './notification-bell'

export function Header() {
  const { user, tenant } = useAuthStore()
  const { sidebarOpen, pageTitle, setMobileNavOpen } = useUIStore()
  const pathname = usePathname()

  const initials = user?.full_name
    ? user.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'U'

  // Derive a breadcrumb from the pathname as a fallback when no PageTitle is set
  const routeLabel = (() => {
    const segments = pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    if (!last || last === 'dashboard') return ''
    return last.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  })()

  const displayTitle = pageTitle || routeLabel

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
      'fixed top-0 end-0 start-0 h-14 z-30',
      'bg-elevated/95 backdrop-blur-sm border-b border-border',
      'flex items-center gap-3 px-4 lg:px-6',
      'transition-[inset-inline-start] duration-200',
      sidebarOpen ? 'lg:start-64' : 'lg:start-16'
    )}>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileNavOpen(true)}
        className="lg:hidden p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface transition-colors shrink-0"
        aria-label="Open navigation menu"
      >
        <Menu className="w-[18px] h-[18px]" aria-hidden="true" />
      </button>

      {/* Page title — wayfinding context */}
      {displayTitle && (
        <p className="hidden lg:block text-[13px] font-medium text-fg-secondary truncate flex-1">
          {displayTitle}
        </p>
      )}
      {!displayTitle && <div className="hidden lg:block flex-1" />}

      {/* Right: notifications + user identity */}
      <div className="flex items-center gap-3 ms-auto">
        <NotificationBell />

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
            <span className="text-accent-fg text-[11px] font-semibold leading-none select-none">
              {initials}
            </span>
          </div>

          <div className="hidden sm:block leading-tight">
            <p className="text-[13px] font-medium text-fg leading-none">{user?.full_name ?? 'User'}</p>
            {tenant?.name && (
              <p className="text-[11px] text-fg-muted leading-none mt-0.5">{tenant.name}</p>
            )}
          </div>
        </div>
      </div>
    </motion.header>
  )
}
