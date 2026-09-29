'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, GraduationCap, Users, BookOpen, ClipboardList,
  CalendarDays, Bell, Inbox, LogOut, ArrowLeftRight,
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'
import { writeLocaleCookie } from '@/components/shared/locale-switcher'
import { LocaleToggle } from '@/components/public/locale-toggle'
import { ThemeToggle } from '@/components/public/theme-toggle'
import { localizedPath } from '@/i18n/public-routes'
import { BrandMark } from '@/components/shared/brand-mark'

// Frame of the /demo tour: the same public look as the marketing pages
// (`.eq-public` from app/demo/layout.tsx, light and dark). On large screens a
// sticky sidebar; on phones the menu becomes a row of chips under the header.
// The demo mirrors the product, so unlike the marketing pages it keeps icons.

const ICONS = { LayoutDashboard, GraduationCap, Users, BookOpen, ClipboardList, CalendarDays, Bell, Inbox } as const
export type DemoIcon = keyof typeof ICONS

export interface DemoNavItem {
  label: string
  href: string
  icon: DemoIcon
}

export function DemoShell({ role, items, children }: { role: string; items: DemoNavItem[]; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations('public.demo')
  const locale = useLocale() as Locale
  const tenant = getDemoData(locale).tenant
  const [switching, startTransition] = useTransition()

  function pickLocale(next: Locale) {
    writeLocaleCookie(next)
    startTransition(() => router.refresh())
  }

  return (
    <div className="min-h-screen bg-slate-950 lg:flex">
      <aside className="lg:w-72 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen flex flex-col bg-slate-900/70 border-b lg:border-b-0 lg:border-e border-slate-800">
        <div className="p-4 lg:p-5 flex lg:block items-center justify-between gap-3">
          <Link href={localizedPath(locale, '/')} dir="ltr" className="eq-brand flex items-center gap-2.5">
            <BrandMark size={36} />
            <span className="eq-wordmark font-bold text-lg">EduQuest</span>
          </Link>
          <div className="lg:mt-5 min-w-0 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
            <p className="text-white text-sm font-semibold truncate">{tenant.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-slate-400 text-xs truncate">{t(`roles.${role}.label`)}</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-semibold">{t('shell.demoMode')}</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 pb-3 lg:pb-0">
          <ul className="flex lg:flex-col gap-1 overflow-x-auto [scrollbar-width:none]">
            {items.map(item => {
              const Icon = ICONS[item.icon]
              const isActive = pathname === item.href
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors whitespace-nowrap ${
                      isActive ? 'bg-blue-600 text-on-accent shadow shadow-blue-600/25' : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
                    }`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="hidden lg:block p-3 border-t border-slate-800 space-y-1">
          <Link href={localizedPath(locale, '/demo')} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors">
            <ArrowLeftRight className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{t('shell.tryAnother')}</span>
          </Link>
          <Link href={localizedPath(locale, '/')} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-colors">
            <LogOut className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{t('shell.exit')}</span>
          </Link>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-20 min-h-16 border-b border-slate-800 bg-slate-950/85 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 px-4 lg:px-8 py-3">
          <p className="flex items-center gap-2.5 text-slate-400 text-sm">
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-amber-400 motion-safe:animate-pulse shrink-0" />
            <span>
              {t('shell.banner')}{' '}
              <Link href={localizedPath(locale, '/contact')} className="text-blue-400 hover:text-blue-300 underline underline-offset-4">{t('shell.bannerContact')}</Link>{' '}
              {t('shell.bannerEnd')}
            </span>
          </p>
          <div className={`flex items-center gap-2 shrink-0 ${switching ? 'opacity-60' : ''}`}>
            <Link href={localizedPath(locale, '/demo')} className="lg:hidden px-3 py-1.5 rounded-full border border-slate-700 text-slate-300 text-xs hover:text-white">{t('shell.tryAnother')}</Link>
            <ThemeToggle />
            <LocaleToggle active={locale} onPick={pickLocale} />
          </div>
        </header>
        <main className="p-4 sm:p-6 lg:p-8 max-w-[88rem]">{children}</main>
      </div>
    </div>
  )
}

export function DemoStatCard({ label, value, icon: Icon, color, bg }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 hover:border-slate-700 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-400 text-sm">{label}</p>
        <div className={`p-2.5 rounded-xl ${bg}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </div>
      <p className="text-3xl font-bold text-white tabular-nums">{value}</p>
    </div>
  )
}

export function DemoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <h3 className="text-white font-semibold mb-4">{title}</h3>
      {children}
    </div>
  )
}
