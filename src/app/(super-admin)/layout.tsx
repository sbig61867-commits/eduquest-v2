import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { ScopedIntlProvider } from '@/i18n/provider'
import { getTranslations } from 'next-intl/server'

// `staff` rides along because the invitations page and the permissions editor
// are the shared staff components, rendered here for the platform owner.
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('superAdmin')
  const navItems = [
    { label: t('nav.dashboard'),   href: '/super-admin/dashboard',   icon: 'LayoutDashboard' as const },
    { label: t('nav.tenants'),     href: '/super-admin/tenants',     icon: 'Building2' as const },
    { label: t('nav.users'),       href: '/super-admin/users',       icon: 'Users' as const },
    { label: t('nav.permissions'), href: '/super-admin/permissions', icon: 'ShieldCheck' as const },
    { label: t('nav.invitations'), href: '/super-admin/invitations', icon: 'Mail' as const },
    { label: t('nav.messages'),    href: '/super-admin/messages',    icon: 'Inbox' as const },
    { label: t('nav.reports'),     href: '/super-admin/reports',     icon: 'BarChart2' as const },
    { label: t('nav.features'),    href: '/super-admin/features',    icon: 'Flag' as const },
    { label: t('nav.audit'),       href: '/super-admin/audit',       icon: 'ShieldCheck' as const },
    { label: t('nav.settings'),    href: '/super-admin/settings',    icon: 'Settings' as const },
  ]
  return (
    <ScopedIntlProvider namespaces={['common', 'terms', 'superAdmin', 'staff']}>
      <div className="min-h-screen bg-slate-950">
        <Sidebar items={navItems} title={t('sidebarTitle')} />
        <ContentShell>
          <Header title={t('dashboardTitle')} />
          <main className="p-4 lg:p-6 !pt-20">{children}</main>
        </ContentShell>
      </div>
    </ScopedIntlProvider>
  )
}
