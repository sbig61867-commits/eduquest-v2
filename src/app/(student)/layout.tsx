import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { StudentQuickAccessPanel } from '@/components/student/quick-access-panel'
import { AnnouncementPopup } from '@/components/student/announcement-popup'
import { CENTRE_TRAINEE_LABEL } from '@/lib/student-track'

const navItems = [
  { label: 'لوحة المعلومات', href: '/student/dashboard', icon: 'LayoutDashboard' as const },
  { label: 'دروسي', href: '/student/lessons',  icon: 'BookOpen' as const },
  { label: 'مساقاتي', href: '/student/courses',  icon: 'Layers' as const },
  { label: 'الاختبارات',      href: '/student/exams',    icon: 'ClipboardList' as const },
  { label: 'الجدول',   href: '/student/schedule', icon: 'CalendarDays' as const },
  { label: 'الدرجات', href: '/student/grades', icon: 'BarChart2' as const },
  { label: 'الإشعارات', href: '/student/notifications', icon: 'Bell' as const },
  { label: 'الملف الشخصي', href: '/student/profile', icon: 'GraduationCap' as const },
]

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TenantWatcher />
      <Sidebar items={navItems} title="طالب" centreTraineeTitle={CENTRE_TRAINEE_LABEL} />
      <ContentShell>
        <Header title="بوابة الطالب" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
      <StudentQuickAccessPanel />
      <AnnouncementPopup />
    </div>
  )
}
