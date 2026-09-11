import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { StudentQuickAccessPanel } from '@/components/student/quick-access-panel'

const navItems = [
  { label: 'Dashboard', href: '/student/dashboard', icon: 'LayoutDashboard' as const },
  { label: 'My Lessons', href: '/student/lessons',  icon: 'BookOpen' as const },
  { label: 'My Courses', href: '/student/courses',  icon: 'Layers' as const },
  { label: 'Exams',      href: '/student/exams',    icon: 'ClipboardList' as const },
  { label: 'Schedule',   href: '/student/schedule', icon: 'CalendarDays' as const },
  { label: 'Grades', href: '/student/grades', icon: 'BarChart2' as const },
  { label: 'Notifications', href: '/student/notifications', icon: 'Bell' as const },
  { label: 'Profile', href: '/student/profile', icon: 'GraduationCap' as const },
]

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TenantWatcher />
      <Sidebar items={navItems} title="Student" />
      <ContentShell>
        <Header title="Student Portal" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
      <StudentQuickAccessPanel />
    </div>
  )
}
