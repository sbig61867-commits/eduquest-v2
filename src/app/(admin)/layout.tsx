import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { ScopedIntlProvider } from '@/i18n/provider'
import { getTranslations } from 'next-intl/server'


// C1 in practice: this subtree gets `common` + `admin` and nothing else. The
// teacher and student dictionaries are never serialized into an /admin page.
// The remaining route groups adopt this same wrapper when their strings are
// extracted — Phase 0b deliberately proves the pattern on one group rather
// than touching all five.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('admin')
  const navItems = [
    { label: t('nav.dashboard'),     href: '/admin/dashboard',     icon: 'LayoutDashboard' as const },
    { label: t('nav.teachers'),      href: '/admin/teachers',      icon: 'GraduationCap' as const },
    { label: t('nav.students'),      href: '/admin/students',      icon: 'Users' as const },
    { label: t('nav.academic'),      href: '/admin/academic',      icon: 'Network' as const, academicOnly: true },
    { label: t('nav.groups'),        href: '/admin/groups',        icon: 'Layers' as const, term: 'groups' as const },
    { label: t('nav.courses'),       href: '/admin/courses',       icon: 'BookOpen' as const },
    { label: t('nav.lessons'),       href: '/admin/lessons',       icon: 'BookOpen' as const },
    { label: t('nav.exams'),         href: '/admin/exams',         icon: 'ClipboardList' as const },
    { label: t('nav.requests'),      href: '/admin/requests',      icon: 'Inbox' as const },
    { label: t('nav.appeals'),       href: '/admin/appeals',       icon: 'Gavel' as const },
    { label: t('nav.announcements'), href: '/admin/announcements', icon: 'Bell' as const },
    { label: t('nav.schedules'),     href: '/admin/schedules',     icon: 'CalendarDays' as const },
    { label: t('nav.centerStaff'),   href: '/admin/center-staff',  icon: 'ShieldCheck' as const, centerOnly: true },
    { label: t('nav.archive'),       href: '/admin/archive',       icon: 'Archive' as const },
    { label: t('nav.invitations'),   href: '/admin/invitations',   icon: 'Mail' as const },
    { label: t('nav.settings'),      href: '/admin/settings',      icon: 'Settings' as const },
  ]
  return (
    <ScopedIntlProvider namespaces={['common', 'terms', 'admin', 'staff']}>
      <div className="min-h-screen bg-slate-950">
        <TenantWatcher />
        <Sidebar items={navItems} title={t('sidebarTitle')} titleTerm="institutionAdmin" />
        <ContentShell>
          <Header title={t('dashboardTitle')} />
          <main className="p-4 lg:p-6 !pt-20">{children}</main>
        </ContentShell>
      </div>
    </ScopedIntlProvider>
  )
}
