import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'

const navItems = [
  { label: 'لوحة المعلومات',    href: '/super-admin/dashboard',    icon: 'LayoutDashboard' as const },
  { label: 'المؤسسات',      href: '/super-admin/tenants',      icon: 'Building2' as const },
  { label: 'كل المستخدمين',    href: '/super-admin/users',        icon: 'Users' as const },
  { label: 'الصلاحيات',  href: '/super-admin/permissions',  icon: 'ShieldCheck' as const },
  { label: 'الدعوات',  href: '/super-admin/invitations',  icon: 'Mail' as const },
  { label: 'الرسائل',     href: '/super-admin/messages',     icon: 'Inbox' as const },
  { label: 'التقارير',      href: '/super-admin/reports',      icon: 'BarChart2' as const },
  { label: 'مفاتيح المزايا',href: '/super-admin/features',     icon: 'Flag' as const },
  { label: 'سجل التدقيق',   href: '/super-admin/audit',        icon: 'ShieldCheck' as const },
  { label: 'الإعدادات',     href: '/super-admin/settings',     icon: 'Settings' as const },
]

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar items={navItems} title="المدير العام" />
      <ContentShell>
        <Header title="لوحة المدير العام" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
