import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

const items: DemoNavItem[] = [
  { label: 'لوحة التحكم', href: '/demo/teacher', icon: 'LayoutDashboard' },
  { label: 'المجموعات', href: '/demo/teacher/groups', icon: 'Users' },
  { label: 'الاختبارات', href: '/demo/teacher/exams', icon: 'ClipboardList' },
]

export default function DemoTeacherLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell role="teacher" items={items}>{children}</DemoShell>
}
