import type { Metadata } from 'next'
import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

const items: DemoNavItem[] = [
  { label: 'لوحة التحكم', href: '/demo/student', icon: 'LayoutDashboard' },
  { label: 'الكورسات', href: '/demo/student/courses', icon: 'BookOpen' },
  { label: 'الاختبارات', href: '/demo/student/exams', icon: 'ClipboardList' },
  { label: 'العلامات', href: '/demo/student/grades', icon: 'GraduationCap' },
]

export const metadata: Metadata = {
  title: 'العرض التجريبي — لوحة الطالب — EduQuest',
  description: 'جولة تجريبية في لوحة الطالب على منصة EduQuest ببيانات وهمية.',
}

export default function DemoStudentLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell role="student" items={items}>{children}</DemoShell>
}
