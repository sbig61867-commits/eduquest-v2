import { getTranslations } from 'next-intl/server'

import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { StudentQuickAccessPanel } from '@/components/student/quick-access-panel'
import { AnnouncementPopup } from '@/components/student/announcement-popup'
import { ScopedIntlProvider } from '@/i18n/provider'

// The nav is built per request from the `student` namespace rather than held
// in a module-level constant: a constant is evaluated once at import time,
// which would freeze whichever locale happened to render first and serve it
// to everyone.
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('student')

  const navItems = [
    { label: t('nav.dashboard'),     href: '/student/dashboard',     icon: 'LayoutDashboard' as const },
    { label: t('nav.lessons'),       href: '/student/lessons',       icon: 'BookOpen' as const },
    { label: t('nav.courses'),       href: '/student/courses',       icon: 'Layers' as const },
    { label: t('nav.exams'),         href: '/student/exams',         icon: 'ClipboardList' as const },
    { label: t('nav.schedule'),      href: '/student/schedule',      icon: 'CalendarDays' as const },
    { label: t('nav.attendance'),    href: '/student/attendance',    icon: 'ClipboardCheck' as const },
    { label: t('nav.grades'),        href: '/student/grades',        icon: 'BarChart2' as const },
    { label: t('nav.notifications'), href: '/student/notifications', icon: 'Bell' as const },
    { label: t('nav.profile'),       href: '/student/profile',       icon: 'GraduationCap' as const },
  ]

  return (
    <ScopedIntlProvider namespaces={['common', 'student', 'terms']}>
      <div className="min-h-screen bg-slate-950">
        <TenantWatcher />
        <Sidebar items={navItems} title={t('roleTitle')} centreTraineeTitle={t('centreTraineeTitle')} />
        <ContentShell>
          <Header title={t('portalTitle')} />
          <main className="p-4 lg:p-6 !pt-20">{children}</main>
        </ContentShell>
        <StudentQuickAccessPanel />
        <AnnouncementPopup />
      </div>
    </ScopedIntlProvider>
  )
}
