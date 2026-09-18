import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'

const navItems = [
  { label: 'لوحة المعلومات', href: '/admin/dashboard',   icon: 'LayoutDashboard' as const },
  { label: 'المعلمون',      href: '/admin/teachers',     icon: 'GraduationCap' as const },
  { label: 'الطلاب',        href: '/admin/students',     icon: 'Users' as const },
  { label: 'الهيكل الأكاديمي', href: '/admin/academic',  icon: 'Network' as const, academicOnly: true },
  { label: 'المجموعات',     href: '/admin/groups',       icon: 'Layers' as const, term: 'groups' as const },
  { label: 'المساقات',      href: '/admin/courses',      icon: 'BookOpen' as const },
  { label: 'الدروس',        href: '/admin/lessons',      icon: 'BookOpen' as const },
  { label: 'الاختبارات',    href: '/admin/exams',        icon: 'ClipboardList' as const },
  { label: 'الطلبات',       href: '/admin/requests',     icon: 'Inbox' as const },
  { label: 'التظلمات',      href: '/admin/appeals',      icon: 'Gavel' as const },
  { label: 'الإعلانات',     href: '/admin/announcements', icon: 'Bell' as const },
  { label: 'الجداول',       href: '/admin/schedules',    icon: 'CalendarDays' as const },
  { label: 'موظفو المركز',  href: '/admin/center-staff',  icon: 'ShieldCheck' as const, centerOnly: true },
  { label: 'الأرشيف',       href: '/admin/archive',      icon: 'Archive' as const },
  { label: 'الدعوات',       href: '/admin/invitations',  icon: 'Mail' as const },
  { label: 'الإعدادات',     href: '/admin/settings',     icon: 'Settings' as const },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TenantWatcher />
      <Sidebar items={navItems} title="مدير الجامعة" titleTerm="institutionAdminAr" />
      <ContentShell>
        <Header title="لوحة الإدارة" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
