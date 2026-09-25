'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getTerms, type Terms } from '@/lib/terminology'
import { getStudentTrack } from '@/lib/student-track'
import {
  LogOut, ChevronLeft,
  LayoutDashboard, Building2, Users, Settings, Flag, ShieldCheck,
  GraduationCap, BookOpen, ClipboardList, ClipboardCheck, Activity, BarChart2, Bell, Mail, Layers, Inbox, Archive, CalendarDays, Gavel, Network,
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
  ClipboardCheck,
  Activity,
  BarChart2,
  Bell,
  Mail,
  Layers,
  Inbox,
  Archive,
  CalendarDays,
  Gavel,
  Network,
} as const

export type IconName = keyof typeof ICONS

export interface NavItem {
  label: string
  href: string
  icon: IconName
  // When set, the label follows the tenant's institution type (terminology.ts)
  term?: keyof Terms
  // Hidden unless the tenant has switched to the academic structure
  academicOnly?: boolean
  // Hidden for institutions without a continuing-education centre
  centerOnly?: boolean
}

interface SidebarProps {
  items: NavItem[]
  title: string
  titleTerm?: keyof Terms
  // Title shown instead when the signed-in student is a continuing-education trainee
  centreTraineeTitle?: string
}

export function Sidebar({ items, title, titleTerm, centreTraineeTitle }: SidebarProps) {
  const t = useTranslations('common.actions')
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useUIStore()
  const { tenant, reset } = useAuthStore()
  const isCentreTrainee = useAuthStore(s =>
    s.user?.role === 'student' && getStudentTrack(s.user.is_university_student, s.tenant?.has_center) === 'centre')
  const terms = getTerms(tenant?.institution_type, locale)
  const router = useRouter()
  const supabase = createClient()
  const [signingOut, setSigningOut] = useState(false)

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileNavOpen(false) }, [pathname, setMobileNavOpen])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('[signOut]', e)
    } finally {
      // Always clear local state and leave, even if the network call itself
      // failed — otherwise the button is left permanently disabled with no
      // way to retry (setSigningOut(true) never gets undone).
      reset()
      router.push('/login')
    }
  }

  return (
    <>
      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className={cn(
        'fixed start-0 top-0 h-full bg-slate-900 border-e border-slate-800 flex flex-col transition-all duration-300 z-50',
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
        // further right, not left.
        'w-64',
        mobileNavOpen ? 'translate-x-0' : 'max-lg:-translate-x-full max-lg:rtl:translate-x-full',
        sidebarOpen ? 'lg:w-64' : 'lg:w-16'
      )}>
        <div className="flex items-center justify-between p-4 border-b border-slate-800 h-16">
          {(sidebarOpen || mobileNavOpen) && (
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                <span className="text-white text-sm font-bold">E</span>
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold truncate">{tenant?.name ?? 'EduQuest'}</p>
                <p className="text-slate-400 text-xs truncate">{isCentreTrainee && centreTraineeTitle ? centreTraineeTitle : titleTerm ? terms[titleTerm] : title}</p>
              </div>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className="hidden lg:block p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ms-auto"
          >
            <ChevronLeft className={cn('w-4 h-4 transition-transform', !sidebarOpen && 'rotate-180')} />
          </button>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ms-auto"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {items.filter(item =>
            (!item.academicOnly || tenant?.structure_mode === 'academic') &&
            (!item.centerOnly || tenant?.has_center !== false)
          ).map((item) => {
            const Icon = ICONS[item.icon]
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                )}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {(sidebarOpen || mobileNavOpen) && <span className="text-sm font-medium truncate">{item.term ? terms[item.term] : item.label}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-slate-800">
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors w-full disabled:opacity-50"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {(sidebarOpen || mobileNavOpen) && <span className="text-sm font-medium">{signingOut ? t('signingOut') : t('signOut')}</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
