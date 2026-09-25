import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.demo')
  return { title: t('meta.teacher'), description: t('meta.roleDescription', { role: t('roles.teacher.dash') }) }
}

export default async function DemoTeacherLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('public.demo')
  const items: DemoNavItem[] = [
    { label: t('nav.dashboard'), href: '/demo/teacher', icon: 'LayoutDashboard' as const },
    { label: t('nav.groups'), href: '/demo/teacher/groups', icon: 'Users' as const },
    { label: t('nav.exams'), href: '/demo/teacher/exams', icon: 'ClipboardList' as const },
  ]
  return <DemoShell role="teacher" items={items}>{children}</DemoShell>
}
