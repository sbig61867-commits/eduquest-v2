import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'

const navItems = [
  { label: 'Dashboard', href: '/student/dashboard', icon: 'LayoutDashboard' as const },
  { label: 'My Lessons', href: '/student/lessons', icon: 'BookOpen' as const },
  { label: 'Exams', href: '/student/exams', icon: 'ClipboardList' as const },
  { label: 'Grades', href: '/student/grades', icon: 'BarChart2' as const },
  { label: 'Notifications', href: '/student/notifications', icon: 'Bell' as const },
  { label: 'Profile', href: '/student/profile', icon: 'GraduationCap' as const },
]

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar items={navItems} title="Student" />
      <div className="pl-64 transition-all duration-300">
        <Header title="Student Portal" />
        <main className="pt-16 p-6">{children}</main>
      </div>
    </div>
  )
}
