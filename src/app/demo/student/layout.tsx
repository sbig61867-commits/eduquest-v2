import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

const items: DemoNavItem[] = [
  { label: 'لوحة التحكم', href: '/demo/student', icon: 'LayoutDashboard' },
  { label: 'الكورسات', href: '/demo/student/courses', icon: 'BookOpen' },
  { label: 'الاختبارات', href: '/demo/student/exams', icon: 'ClipboardList' },
  { label: 'العلامات', href: '/demo/student/grades', icon: 'GraduationCap' },
]

export default function DemoStudentLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell role="student" items={items}>{children}</DemoShell>
}
