import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { StudentQuickAccessPanel } from '@/components/student/quick-access-panel'
import type { NavGroup } from '@/components/shared/sidebar'

const groups: NavGroup[] = [
  {
    label: 'Learning',
    items: [
      { label: 'Dashboard',  href: '/student/dashboard', icon: 'LayoutDashboard' },
      { label: 'My Lessons', href: '/student/lessons',   icon: 'BookOpen' },
      { label: 'My Courses', href: '/student/courses',   icon: 'Layers' },
      { label: 'Exams',      href: '/student/exams',     icon: 'ClipboardList' },
    ],
  },
  {
    label: 'Progress',
    items: [
      { label: 'Schedule', href: '/student/schedule', icon: 'CalendarDays' },
      { label: 'Grades',   href: '/student/grades',   icon: 'BarChart2' },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Notifications', href: '/student/notifications', icon: 'Bell' },
      { label: 'Profile',       href: '/student/profile',       icon: 'GraduationCap' },
    ],
  },
]

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <TenantWatcher />
      <Sidebar groups={groups} roleLabel="Student" />
      <ContentShell>
        <Header />
        <main className="p-4 lg:p-6 pt-14">{children}</main>
      </ContentShell>
      <StudentQuickAccessPanel />
    </div>
  )
}
