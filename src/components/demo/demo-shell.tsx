'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, GraduationCap, Users, BookOpen, ClipboardList,
  CalendarDays, Bell, Inbox, LogOut, ArrowLeftRight,
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'
import { LocaleSwitcher } from '@/components/shared/locale-switcher'

const ICONS = { LayoutDashboard, GraduationCap, Users, BookOpen, ClipboardList, CalendarDays, Bell, Inbox } as const
export type DemoIcon = keyof typeof ICONS

export interface DemoNavItem {
  label: string
  href: string
  icon: DemoIcon
}

export function DemoShell({ role, items, children }: { role: string; items: DemoNavItem[]; children: React.ReactNode }) {
  const pathname = usePathname()
  const t = useTranslations('public.demo')
  const tenant = getDemoData(useLocale() as Locale).tenant

  return (
    <div className="min-h-screen bg-slate-950 lg:flex">
      <aside className="lg:w-64 bg-slate-900 border-s border-slate-800 flex flex-col">
        <div className="flex items-center gap-2 p-4 border-b border-slate-800 h-16">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">E</span>
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{tenant.name}</p>
            <p className="text-slate-400 text-xs truncate">{t(`roles.${role}.label`)} · {t('shell.demoMode')}</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {items.map((item) => {
            const Icon = ICONS[item.icon]
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="text-sm font-medium truncate">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-1">
          <Link href="/demo" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors w-full">
            <ArrowLeftRight className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{t('shell.tryAnother')}</span>
          </Link>
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors w-full">
            <LogOut className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{t('shell.exit')}</span>
          </Link>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur flex items-center justify-between px-4 lg:px-6">
          <p className="text-slate-400 text-sm">
            {t('shell.banner')} <Link href="/contact" className="text-blue-400 hover:underline">{t('shell.bannerContact')}</Link> {t('shell.bannerEnd')}
          </p>
          <LocaleSwitcher className="shrink-0" />
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}

export function DemoStatCard({ label, value, icon: Icon, color, bg }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-400 text-sm">{label}</p>
        <div className={`p-2 rounded-lg ${bg}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
    </div>
  )
}

export function DemoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">{title}</h3>
      {children}
    </div>
  )
}
