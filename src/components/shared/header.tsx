'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { getRoleLabel } from '@/lib/utils'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NotificationBell } from './notification-bell'

export function Header() {
  const { user, tenant } = useAuthStore()
  const { sidebarOpen, setMobileNavOpen } = useUIStore()

  const initials = user?.full_name
    ? user.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'U'

  return (
    <header className={cn(
      'fixed top-0 end-0 start-0 h-16 z-30',
      'bg-elevated/90 backdrop-blur-md border-b border-border',
      'flex items-center justify-between px-4 lg:px-6',
      'transition-[inset-inline-start] duration-200',
      sidebarOpen ? 'lg:start-64' : 'lg:start-16'
    )}>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileNavOpen(true)}
        className="lg:hidden p-2 rounded-md text-fg-muted hover:text-fg hover:bg-surface transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* Spacer on desktop (no static title — pages provide their own <h1>) */}
      <div className="hidden lg:block" />

      {/* Right: notifications + user */}
      <div className="flex items-center gap-3">
        <NotificationBell />

        <div className="flex items-center gap-2.5">
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0">
            <span className="text-accent-fg text-xs font-semibold leading-none select-none">
              {initials}
            </span>
          </div>

          {/* Name + role — hidden on small screens */}
          <div className="hidden sm:block">
            <p className="text-fg text-sm font-medium leading-none">{user?.full_name ?? 'User'}</p>
            <p className="text-fg-muted text-xs mt-0.5 leading-none">
              {user?.role ? getRoleLabel(user.role) : ''}
              {tenant?.name && <span className="text-fg-muted"> · {tenant.name}</span>}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}
