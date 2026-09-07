import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import type { NavGroup } from '@/components/shared/sidebar'

// Centre manager capabilities are per-user (users.permissions JSONB).
// The nav items here represent the maximum possible set — each page
// renders according to what the signed-in user has actually been granted.
const groups: NavGroup[] = [
  {
    items: [
      { label: 'Dashboard', href: '/center/dashboard', icon: 'LayoutDashboard' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Announcements', href: '/center/announcements', icon: 'Bell' },
      { label: 'Schedules',     href: '/center/schedules',     icon: 'CalendarDays' },
    ],
  },
]

export default function CenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <TenantWatcher />
      <Sidebar groups={groups} roleLabel="Centre Manager" />
      <ContentShell>
        <Header />
        <main className="p-4 lg:p-6 pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
