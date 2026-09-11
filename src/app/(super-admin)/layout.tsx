import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import type { NavGroup } from '@/components/shared/sidebar'

const groups: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      { label: 'Dashboard', href: '/super-admin/dashboard', icon: 'LayoutDashboard' },
      { label: 'Tenants',   href: '/super-admin/tenants',   icon: 'Building2' },
      { label: 'All Users', href: '/super-admin/users',     icon: 'Users' },
    ],
  },
  {
    label: 'Security',
    items: [
      { label: 'Permissions', href: '/super-admin/permissions', icon: 'ShieldCheck' },
      { label: 'Audit Logs',  href: '/super-admin/audit',       icon: 'Flag' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Invitations',   href: '/super-admin/invitations', icon: 'Mail' },
      { label: 'Messages',      href: '/super-admin/messages',    icon: 'Inbox' },
      { label: 'Reports',       href: '/super-admin/reports',     icon: 'BarChart2' },
      { label: 'AI Usage',      href: '/super-admin/ai-usage',    icon: 'Sparkles' },
      { label: 'Feature Flags', href: '/super-admin/features',    icon: 'Flag' },
      { label: 'Settings',      href: '/super-admin/settings',    icon: 'Settings' },
    ],
  },
]

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar groups={groups} roleLabel="Super Admin" />
      <ContentShell>
        <Header />
        <main className="p-4 lg:p-6 pt-14">{children}</main>
      </ContentShell>
    </div>
  )
}
