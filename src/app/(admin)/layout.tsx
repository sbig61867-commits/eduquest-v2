import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import type { NavGroup } from '@/components/shared/sidebar'

const groups: NavGroup[] = [
  {
    items: [
      { label: 'Dashboard', href: '/admin/dashboard', icon: 'LayoutDashboard' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Teachers',     href: '/admin/teachers',    icon: 'GraduationCap' },
      { label: 'Students',     href: '/admin/students',    icon: 'Users' },
      { label: 'Groups',       href: '/admin/groups',      icon: 'Layers' },
      { label: 'Centre Staff', href: '/admin/center-staff', icon: 'ShieldCheck' },
      { label: 'Invitations',  href: '/admin/invitations', icon: 'Mail' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Courses', href: '/admin/courses', icon: 'GraduationCap' },
      { label: 'Lessons', href: '/admin/lessons', icon: 'BookOpen' },
      { label: 'Exams',   href: '/admin/exams',   icon: 'ClipboardList' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Requests',      href: '/admin/requests',      icon: 'Inbox' },
      { label: 'Announcements', href: '/admin/announcements', icon: 'Bell' },
      { label: 'Schedules',     href: '/admin/schedules',     icon: 'CalendarDays' },
      { label: 'Archive',       href: '/admin/archive',       icon: 'Archive' },
      { label: 'Settings',      href: '/admin/settings',      icon: 'Settings' },
    ],
  },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <TenantWatcher />
      <Sidebar groups={groups} roleLabel="University Admin" />
      <ContentShell>
        <Header />
        <main className="p-4 lg:p-6 pt-14">{children}</main>
      </ContentShell>
    </div>
  )
}
