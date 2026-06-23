import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'

const navItems = [
  { label: 'Dashboard',   href: '/teacher/dashboard',   icon: 'LayoutDashboard' as const },
  { label: 'My Groups',   href: '/teacher/groups',      icon: 'Users' as const },
  { label: 'Lessons',     href: '/teacher/lessons',     icon: 'BookOpen' as const },
  { label: 'Courses',     href: '/teacher/courses',     icon: 'GraduationCap' as const },
  { label: 'Exams',       href: '/teacher/exams',       icon: 'ClipboardList' as const },
  { label: 'Grades',      href: '/teacher/grades',      icon: 'BarChart2' as const },
  { label: 'Proctoring',  href: '/teacher/proctoring',  icon: 'ShieldCheck' as const },
  { label: 'Invitations', href: '/teacher/invitations', icon: 'Mail' as const },
]

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar items={navItems} title="Teacher" />
      <div className="pl-64 transition-all duration-300">
        <Header title="Teacher Panel" />
        <main className="pt-16 p-6">{children}</main>
      </div>
    </div>
  )
}
