import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { ScopedIntlProvider } from '@/i18n/provider'
import { getTranslations } from 'next-intl/server'

// Continuing-education centre manager / admin assistant. What they can
// actually do is governed per-user by `users.permissions` (see
// src/lib/permissions.ts) — the admin grants each capability explicitly.
export default async function CenterLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('center')
  const navItems = [
    { label: t('nav.dashboard'),     href: '/center/dashboard',     icon: 'LayoutDashboard' as const },
    { label: t('nav.teachers'),      href: '/center/teachers',      icon: 'GraduationCap' as const },
    { label: t('nav.students'),      href: '/center/students',      icon: 'Users' as const },
    { label: t('nav.groups'),        href: '/center/groups',        icon: 'Layers' as const, term: 'groups' as const },
    { label: t('nav.courses'),       href: '/center/courses',       icon: 'BookOpen' as const },
    { label: t('nav.attendance'),    href: '/center/attendance',    icon: 'ClipboardList' as const },
    { label: t('nav.analytics'),     href: '/center/analytics',     icon: 'BarChart2' as const },
    { label: t('nav.schedules'),     href: '/center/schedules',     icon: 'CalendarDays' as const },
    { label: t('nav.announcements'), href: '/center/announcements', icon: 'Bell' as const },
    { label: t('nav.mail'),          href: '/center/mail',          icon: 'Mail' as const },
  ]
  return (
    <ScopedIntlProvider namespaces={['common', 'terms', 'center', 'staff']}>
      <div className="min-h-screen bg-slate-950">
        <TenantWatcher />
        <Sidebar items={navItems} title={t('sidebarTitle')} />
        <ContentShell>
          <Header title={t('headerTitle')} />
          <main className="p-4 lg:p-6 !pt-20">{children}</main>
        </ContentShell>
      </div>
    </ScopedIntlProvider>
  )
}
