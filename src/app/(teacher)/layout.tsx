import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'

const navItems = [
  { label: 'Dashboard',   href: '/teacher/dashboard',   icon: 'LayoutDashboard' as const },
  { label: 'My Groups',   href: '/teacher/groups',      icon: 'Users' as const },
  { label: 'Lessons',     href: '/teacher/lessons',     icon: 'BookOpen' as const },
  { label: 'Courses',     href: '/teacher/courses',     icon: 'GraduationCap' as const },
  { label: 'Exams',       href: '/teacher/exams',       icon: 'ClipboardList' as const },
  { label: 'Grades',      href: '/teacher/grades',      icon: 'BarChart2' as const },
  { label: 'Proctoring',  href: '/teacher/proctoring',  icon: 'ShieldCheck' as const },
  { label: 'Schedule',    href: '/teacher/schedule',    icon: 'CalendarDays' as const },
  { label: 'Requests',    href: '/teacher/requests',    icon: 'Inbox' as const },
  { label: 'Invitations', href: '/teacher/invitations', icon: 'Mail' as const },
]

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TenantWatcher />
      <Sidebar items={navItems} title="Teacher" />
      <ContentShell>
        <Header title="Teacher Panel" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
