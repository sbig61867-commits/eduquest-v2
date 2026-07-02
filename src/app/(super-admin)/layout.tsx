import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'

const navItems = [
  { label: 'Dashboard',    href: '/super-admin/dashboard',    icon: 'LayoutDashboard' as const },
  { label: 'Tenants',      href: '/super-admin/tenants',      icon: 'Building2' as const },
  { label: 'All Users',    href: '/super-admin/users',        icon: 'Users' as const },
  { label: 'Invitations',  href: '/super-admin/invitations',  icon: 'Mail' as const },
  { label: 'Messages',     href: '/super-admin/messages',     icon: 'Inbox' as const },
  { label: 'Reports',      href: '/super-admin/reports',      icon: 'BarChart2' as const },
  { label: 'Feature Flags',href: '/super-admin/features',     icon: 'Flag' as const },
  { label: 'Audit Logs',   href: '/super-admin/audit',        icon: 'ShieldCheck' as const },
  { label: 'Settings',     href: '/super-admin/settings',     icon: 'Settings' as const },
]

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar items={navItems} title="Super Admin" />
      <ContentShell>
        <Header title="Super Admin Panel" />
        <main className="pt-16 p-4 lg:p-6">{children}</main>
      </ContentShell>
    </div>
  )
}
