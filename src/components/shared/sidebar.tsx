'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import {
  LogOut, ChevronLeft,
  LayoutDashboard, Building2, Users, Settings, Flag, ShieldCheck,
  GraduationCap, BookOpen, ClipboardList, BarChart2, Bell, Mail,
  Layers, Inbox, Archive, CalendarDays, Megaphone, Sparkles,
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
  Megaphone,
  Sparkles,
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
  const { tenant, user, reset } = useAuthStore()
  const router = useRouter()
  const supabase = createClient()
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => { setMobileNavOpen(false) }, [pathname, setMobileNavOpen])

  async function handleSignOut() {
    setSigningOut(true)
    try { await supabase.auth.signOut() } catch (e) { console.error('[signOut]', e) }
    finally { reset(); router.push('/login') }
  }

  const isExpanded = sidebarOpen || mobileNavOpen

  const initials = user?.full_name
    ? user.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <>
      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      <aside className={cn(
        'fixed start-0 top-0 h-full flex flex-col z-50',
        'bg-surface border-e border-border',
        'transition-[width,transform] duration-200',
        mobileNavOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64',
        'lg:translate-x-0',
        sidebarOpen ? 'lg:w-64' : 'lg:w-16'
      )}>

        {/* Brand — tenant name + toggle */}
        <div className={cn(
          'flex items-center h-16 border-b border-border shrink-0',
          isExpanded ? 'px-4 gap-3' : 'justify-center px-0'
        )}>
          <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
            <span className="text-accent-fg text-sm font-bold leading-none select-none">E</span>
          </div>

          {isExpanded && (
            <div className="min-w-0 flex-1">
              <p className="text-fg text-sm font-semibold truncate leading-tight">
                {tenant?.name ?? 'EduQuest'}
              </p>
              <p className="text-fg-muted text-xs truncate leading-tight mt-0.5">{roleLabel}</p>
            </div>
          )}

          {/* Desktop collapse toggle */}
          <button
            onClick={toggleSidebar}
            className={cn(
              'hidden lg:flex items-center justify-center w-6 h-6 rounded-md',
              'text-fg-muted hover:text-fg hover:bg-canvas transition-colors shrink-0',
              !isExpanded && 'absolute end-0 translate-x-1/2 top-5 bg-elevated border border-border shadow-sm'
            )}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <ChevronLeft className={cn('w-3.5 h-3.5 transition-transform duration-200', !sidebarOpen && 'rotate-180')} />
          </button>

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
        <nav className="flex-1 overflow-y-auto py-4" aria-label="Primary navigation">
          <div className="space-y-6">
            {groups.map((group, gi) => (
              <div key={gi} className="px-3">
                {group.label && isExpanded && (
                  <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted select-none">
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
                          'relative flex items-center rounded-md transition-colors w-full group',
                          isExpanded ? 'gap-3 px-2 py-2' : 'justify-center p-2',
                          isActive
                            ? 'text-accent'
                            : 'text-fg-secondary hover:text-fg hover:bg-canvas'
                        )}
                      >
                        {/* Sliding active pill */}
                        {isActive && (
                          <motion.span
                            layoutId="sidebar-active-pill"
                            className="absolute inset-0 rounded-md bg-accent-subtle"
                            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                          />
                        )}
                        {isActive && (
                          <span className="absolute start-0 top-1 bottom-1 w-0.5 rounded-e-full bg-accent z-10" />
                        )}
                        <Icon className="relative w-[18px] h-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
                        {isExpanded && (
                          <span className="relative text-[13px] font-medium truncate">{item.label}</span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* User + sign out */}
        <div className="border-t border-border shrink-0">
          {/* User identity (expanded only) */}
          {isExpanded && (
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-7 h-7 rounded-full bg-accent-subtle flex items-center justify-center shrink-0">
                <span className="text-accent text-xs font-semibold leading-none select-none">{initials}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg truncate leading-tight">{user?.full_name ?? 'User'}</p>
              </div>
            </div>
          )}

          <div className="px-3 pb-3">
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className={cn(
                'flex items-center rounded-md w-full transition-colors',
                isExpanded ? 'gap-3 px-2 py-2' : 'justify-center p-2',
                'text-fg-muted hover:text-error hover:bg-error-subtle',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <LogOut className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
              {isExpanded && (
                <span className="text-[13px] font-medium">
                  {signingOut ? 'Signing out…' : 'Sign Out'}
                </span>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
