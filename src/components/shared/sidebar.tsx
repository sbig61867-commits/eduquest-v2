'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import {
  LogOut, ChevronLeft, Loader2,
  LayoutDashboard, Building2, Users, Settings, Flag, ShieldCheck,
  GraduationCap, BookOpen, ClipboardList, BarChart2, Bell, Mail,
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
} as const

export type IconName = keyof typeof ICONS

export interface NavItem {
  label: string
  href: string
  icon: IconName
}

interface SidebarProps {
  items: NavItem[]
  title: string
}

export function Sidebar({ items, title }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar } = useUIStore()
  const { tenant, reset } = useAuthStore()
  const router = useRouter()
  const supabase = createClient()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function handleSignOut() {
    await supabase.auth.signOut()
    reset()
    router.push('/login')
  }

  function handleNavClick(href: string) {
    if (href === pathname) return
    setPendingHref(href)
    startTransition(() => {
      router.push(href)
      // Clear pending after navigation settles
      setTimeout(() => setPendingHref(null), 2000)
    })
  }

  return (
    <aside className={cn(
      'fixed left-0 top-0 h-full bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 z-40',
      sidebarOpen ? 'w-64' : 'w-16'
    )}>
      <div className="flex items-center justify-between p-4 border-b border-slate-800 h-16">
        {sidebarOpen && (
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-bold">E</span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{tenant?.name ?? 'EduQuest'}</p>
              <p className="text-slate-400 text-xs truncate">{title}</p>
            </div>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-auto"
        >
          <ChevronLeft className={cn('w-4 h-4 transition-transform', !sidebarOpen && 'rotate-180')} />
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const Icon = ICONS[item.icon]
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          const isPending = pendingHref === item.href
          return (
            <button
              key={item.href}
              onClick={() => handleNavClick(item.href)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full text-left',
                isActive || isPending
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              )}
            >
              {isPending
                ? <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
                : <Icon className="w-5 h-5 shrink-0" />
              }
              {sidebarOpen && <span className="text-sm font-medium truncate">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <div className="p-3 border-t border-slate-800">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors w-full"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {sidebarOpen && <span className="text-sm font-medium">Sign Out</span>}
        </button>
      </div>
    </aside>
  )
}
