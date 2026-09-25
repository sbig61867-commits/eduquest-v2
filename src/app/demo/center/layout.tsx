import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.demo')
  return { title: t('meta.center'), description: t('meta.roleDescription', { role: t('roles.center.dash') }) }
}

export default async function DemoCenterLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('public.demo')
  const items: DemoNavItem[] = [
    { label: t('nav.dashboard'), href: '/demo/center', icon: 'LayoutDashboard' as const },
    { label: t('nav.schedules'), href: '/demo/center/schedules', icon: 'CalendarDays' as const },
    { label: t('nav.announcements'), href: '/demo/center/announcements', icon: 'Bell' as const },
  ]
  return <DemoShell role="center" items={items}>{children}</DemoShell>
}
