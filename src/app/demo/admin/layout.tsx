import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

const items: DemoNavItem[] = [
  { label: 'لوحة التحكم', href: '/demo/admin', icon: 'LayoutDashboard' },
  { label: 'المعلمون', href: '/demo/admin/teachers', icon: 'GraduationCap' },
  { label: 'الطلاب', href: '/demo/admin/students', icon: 'Users' },
  { label: 'الكورسات', href: '/demo/admin/courses', icon: 'BookOpen' },
]

export default function DemoAdminLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell role="admin" items={items}>{children}</DemoShell>
}
