import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'

const navItems = [
  { label: 'Dashboard',   href: '/admin/dashboard',   icon: 'LayoutDashboard' as const },
  { label: 'Teachers',    href: '/admin/teachers',     icon: 'GraduationCap' as const },
  { label: 'Students',    href: '/admin/students',     icon: 'Users' as const },
  { label: 'Groups',      href: '/admin/groups',       icon: 'Layers' as const },
  { label: 'Courses',     href: '/admin/courses',      icon: 'BookOpen' as const },
  { label: 'Lessons',     href: '/admin/lessons',      icon: 'BookOpen' as const },
  { label: 'Exams',       href: '/admin/exams',        icon: 'ClipboardList' as const },
  { label: 'Requests',    href: '/admin/requests',     icon: 'Inbox' as const },
  { label: 'Announcements', href: '/admin/announcements', icon: 'Bell' as const },
  { label: 'Schedules',   href: '/admin/schedules',    icon: 'CalendarDays' as const },
  { label: 'Centre Staff',  href: '/admin/center-staff',  icon: 'ShieldCheck' as const },
  { label: 'Archive',     href: '/admin/archive',      icon: 'Archive' as const },
  { label: 'Invitations', href: '/admin/invitations',  icon: 'Mail' as const },
  { label: 'Settings',    href: '/admin/settings',     icon: 'Settings' as const },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TenantWatcher />
      <Sidebar items={navItems} title="University Admin" />
      <ContentShell>
        <Header title="Admin Panel" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
