import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { getTranslations } from 'next-intl/server'
import { ScopedIntlProvider } from '@/i18n/provider'

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('teacher')
  const navItems = [
    { label: t('nav.dashboard'),   href: '/teacher/dashboard',   icon: 'LayoutDashboard' as const },
    { label: t('nav.groups'),      href: '/teacher/groups',      icon: 'Users' as const },
    { label: t('nav.lessons'),     href: '/teacher/lessons',     icon: 'BookOpen' as const },
    { label: t('nav.courses'),     href: '/teacher/courses',     icon: 'GraduationCap' as const },
    { label: t('nav.exams'),       href: '/teacher/exams',       icon: 'ClipboardList' as const },
    { label: t('nav.grades'),      href: '/teacher/grades',      icon: 'BarChart2' as const },
    { label: t('nav.attendance'),  href: '/teacher/attendance',  icon: 'ClipboardCheck' as const },
    { label: t('nav.engagement'),  href: '/teacher/engagement',  icon: 'Activity' as const },
    { label: t('nav.proctoring'),  href: '/teacher/proctoring',  icon: 'ShieldCheck' as const },
    { label: t('nav.schedule'),    href: '/teacher/schedule',    icon: 'CalendarDays' as const },
    { label: t('nav.requests'),    href: '/teacher/requests',    icon: 'Inbox' as const },
    { label: t('nav.invitations'), href: '/teacher/invitations', icon: 'Mail' as const },
  ]
  return (
    <ScopedIntlProvider namespaces={['common', 'teacher', 'terms']}>
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
