'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import {
  LogOut, ChevronLeft,
  LayoutDashboard, Building2, Users, Settings, Flag, ShieldCheck,
  GraduationCap, BookOpen, ClipboardList, BarChart2, Bell, Mail,
  Layers, Inbox, Archive, CalendarDays,
} from 'lucide-react'

const ICONS = {
  LayoutDashboard,
  Building2,
  Users,
  Settings,
  Flag,
  ShieldCheck,
  GraduationCap,
  BookOpen,
  ClipboardList,
  BarChart2,
  Bell,
  Mail,
  Layers,
  Inbox,
  Archive,
  CalendarDays,
} as const

export type IconName = keyof typeof ICONS

export interface NavItem {
  label: string
  href: string
  icon: IconName
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

interface SidebarProps {
  groups: NavGroup[]
  roleLabel: string
}

export function Sidebar({ groups, roleLabel }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useUIStore()
  const { tenant, reset } = useAuthStore()
  const router = useRouter()
  const supabase = createClient()
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => { setMobileNavOpen(false) }, [pathname, setMobileNavOpen])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('[signOut]', e)
    } finally {
      reset()
      router.push('/login')
    }
  }

  const isExpanded = sidebarOpen || mobileNavOpen

  return (
    <>
      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className={cn(
        'fixed start-0 top-0 h-full flex flex-col z-50',
        'bg-surface border-e border-border',
        'transition-[width,transform] duration-200',
        mobileNavOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64',
        'lg:translate-x-0',
        sidebarOpen ? 'lg:w-64' : 'lg:w-16'
      )}>
        {/* Brand header */}
        <div className={cn(
          'flex items-center h-16 border-b border-border shrink-0',
          isExpanded ? 'px-4 gap-3' : 'justify-center px-0'
        )}>
          <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
            <span className="text-accent-fg text-sm font-bold leading-none select-none">E</span>
          </div>

          {isExpanded && (
            <div className="min-w-0 flex-1">
              <p className="text-fg text-sm font-semibold truncate">{tenant?.name ?? 'EduQuest'}</p>
              <p className="text-fg-muted text-xs truncate">{roleLabel}</p>
            </div>
          )}

          {/* Desktop toggle */}
          <button
            onClick={toggleSidebar}
            className={cn(
              'hidden lg:flex p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-canvas transition-colors shrink-0',
              !isExpanded && 'absolute end-0 translate-x-1/2 top-4 bg-elevated border border-border shadow-sm'
            )}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <ChevronLeft className={cn('w-4 h-4 transition-transform duration-200', !sidebarOpen && 'rotate-180')} />
          </button>

          {/* Mobile close */}
          {mobileNavOpen && (
            <button
              onClick={() => setMobileNavOpen(false)}
              className="lg:hidden p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-canvas transition-colors shrink-0"
              aria-label="Close menu"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-4" aria-label="Primary navigation">
          {groups.map((group, gi) => (
            <div key={gi} className="px-2">
              {group.label && isExpanded && (
                <p className="px-2 pb-1.5 text-xs font-medium uppercase tracking-widest text-fg-muted select-none">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon]
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch
                      title={!isExpanded ? item.label : undefined}
                      className={cn(
                        'flex items-center rounded-md transition-colors w-full',
                        isExpanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-2',
                        isActive
                          ? 'bg-accent-subtle text-accent'
                          : 'text-fg-secondary hover:text-fg hover:bg-canvas'
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {isExpanded && (
                        <span className="text-sm font-medium truncate">{item.label}</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div className="px-2 py-3 border-t border-border shrink-0">
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className={cn(
              'flex items-center rounded-md w-full transition-colors',
              isExpanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-2',
              'text-fg-muted hover:text-error hover:bg-error-subtle',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            {isExpanded && (
              <span className="text-sm font-medium">
                {signingOut ? 'Signing out…' : 'Sign Out'}
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  )
}
