import { DemoShell, type DemoNavItem } from '@/components/demo/demo-shell'

const items: DemoNavItem[] = [
  { label: 'لوحة التحكم', href: '/demo/center', icon: 'LayoutDashboard' },
  { label: 'الجداول', href: '/demo/center/schedules', icon: 'CalendarDays' },
  { label: 'الإعلانات', href: '/demo/center/announcements', icon: 'Bell' },
]

export default function DemoCenterLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell role="center" items={items}>{children}</DemoShell>
}
