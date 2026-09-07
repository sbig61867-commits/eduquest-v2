import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import type { NavGroup } from '@/components/shared/sidebar'

const groups: NavGroup[] = [
  {
    label: 'Teaching',
    items: [
      { label: 'Dashboard',  href: '/teacher/dashboard',  icon: 'LayoutDashboard' },
      { label: 'My Groups',  href: '/teacher/groups',     icon: 'Users' },
      { label: 'Lessons',    href: '/teacher/lessons',    icon: 'BookOpen' },
      { label: 'Courses',    href: '/teacher/courses',    icon: 'GraduationCap' },
    ],
  },
  {
    label: 'Assessment',
    items: [
      { label: 'Exams',      href: '/teacher/exams',      icon: 'ClipboardList' },
      { label: 'Grades',     href: '/teacher/grades',     icon: 'BarChart2' },
      { label: 'Proctoring', href: '/teacher/proctoring', icon: 'ShieldCheck' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'Schedule',    href: '/teacher/schedule',    icon: 'CalendarDays' },
      { label: 'Requests',    href: '/teacher/requests',    icon: 'Inbox' },
      { label: 'Invitations', href: '/teacher/invitations', icon: 'Mail' },
    ],
  },
]

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <TenantWatcher />
      <Sidebar groups={groups} roleLabel="Teacher" />
      <ContentShell>
        <Header />
        <main className="p-4 lg:p-6 pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
