import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'

// Continuing-education centre manager / admin assistant. What they can
// actually do is governed per-user by `users.permissions` (see
// src/lib/permissions.ts) — the admin grants each capability explicitly.
const navItems = [
  { label: 'لوحة المعلومات',     href: '/center/dashboard',     icon: 'LayoutDashboard' as const },
  { label: 'المعلمون',      href: '/center/teachers',      icon: 'GraduationCap' as const },
  { label: 'الطلاب',      href: '/center/students',      icon: 'Users' as const },
  { label: 'المجموعات',        href: '/center/groups',        icon: 'Layers' as const, term: 'groups' as const },
  { label: 'المساقات',       href: '/center/courses',       icon: 'BookOpen' as const },
  { label: 'الحضور',    href: '/center/attendance',    icon: 'ClipboardList' as const },
  { label: 'الجداول',     href: '/center/schedules',     icon: 'CalendarDays' as const },
  { label: 'الإعلانات', href: '/center/announcements', icon: 'Bell' as const },
  { label: 'بريدي',       href: '/center/mail',          icon: 'Mail' as const },
]

export default function CenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TenantWatcher />
      <Sidebar items={navItems} title="مدير المركز" />
      <ContentShell>
        <Header title="لوحة المركز" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
