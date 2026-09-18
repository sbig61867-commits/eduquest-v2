import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'

const navItems = [
  { label: 'لوحة المعلومات',   href: '/teacher/dashboard',   icon: 'LayoutDashboard' as const },
  { label: 'مجموعاتي',   href: '/teacher/groups',      icon: 'Users' as const },
  { label: 'الدروس',     href: '/teacher/lessons',     icon: 'BookOpen' as const },
  { label: 'المساقات',     href: '/teacher/courses',     icon: 'GraduationCap' as const },
  { label: 'الاختبارات',       href: '/teacher/exams',       icon: 'ClipboardList' as const },
  { label: 'الدرجات',      href: '/teacher/grades',      icon: 'BarChart2' as const },
  { label: 'المراقبة',  href: '/teacher/proctoring',  icon: 'ShieldCheck' as const },
  { label: 'الجدول',    href: '/teacher/schedule',    icon: 'CalendarDays' as const },
  { label: 'الطلبات',    href: '/teacher/requests',    icon: 'Inbox' as const },
  { label: 'الدعوات', href: '/teacher/invitations', icon: 'Mail' as const },
]

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TenantWatcher />
      <Sidebar items={navItems} title="معلم" />
      <ContentShell>
        <Header title="لوحة المعلم" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
