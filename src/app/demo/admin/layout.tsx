import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.demo')
  return { title: t('meta.admin'), description: t('meta.roleDescription', { role: t('roles.admin.dash') }) }
}

export default async function DemoAdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('public.demo')
  const items: DemoNavItem[] = [
    { label: t('nav.dashboard'), href: '/demo/admin', icon: 'LayoutDashboard' as const },
    { label: t('nav.teachers'), href: '/demo/admin/teachers', icon: 'GraduationCap' as const },
    { label: t('nav.students'), href: '/demo/admin/students', icon: 'Users' as const },
    { label: t('nav.courses'), href: '/demo/admin/courses', icon: 'BookOpen' as const },
  ]
  return <DemoShell role="admin" items={items}>{children}</DemoShell>
}
