import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'

const navItems = [
  { label: 'Dashboard',   href: '/admin/dashboard',   icon: 'LayoutDashboard' as const },
  { label: 'Teachers',    href: '/admin/teachers',     icon: 'GraduationCap' as const },
  { label: 'Students',    href: '/admin/students',     icon: 'Users' as const },
  { label: 'Courses',     href: '/admin/courses',      icon: 'BookOpen' as const },
  { label: 'Invitations', href: '/admin/invitations',  icon: 'Mail' as const },
  { label: 'Settings',    href: '/admin/settings',     icon: 'Settings' as const },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar items={navItems} title="University Admin" />
      <div className="pl-64 transition-all duration-300">
        <Header title="Admin Panel" />
        <main className="pt-16 p-6">{children}</main>
      </div>
    </div>
  )
}
