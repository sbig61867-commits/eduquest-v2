import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.demo')
  return { title: t('meta.student'), description: t('meta.roleDescription', { role: t('roles.student.dash') }) }
}

export default async function DemoStudentLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('public.demo')
  const items: DemoNavItem[] = [
    { label: t('nav.dashboard'), href: '/demo/student', icon: 'LayoutDashboard' as const },
    { label: t('nav.courses'), href: '/demo/student/courses', icon: 'BookOpen' as const },
    { label: t('nav.exams'), href: '/demo/student/exams', icon: 'ClipboardList' as const },
    { label: t('nav.grades'), href: '/demo/student/grades', icon: 'GraduationCap' as const },
  ]
  return <DemoShell role="student" items={items}>{children}</DemoShell>
}
