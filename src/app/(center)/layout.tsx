import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'

// Continuing-education centre manager / admin assistant. What they can
// actually do is governed per-user by `users.permissions` (see
// src/lib/permissions.ts) — the admin grants each capability explicitly.
const navItems = [
  { label: 'Dashboard',     href: '/center/dashboard',     icon: 'LayoutDashboard' as const },
  { label: 'Announcements', href: '/center/announcements', icon: 'Bell' as const },
  { label: 'Schedules',     href: '/center/schedules',     icon: 'CalendarDays' as const },
]

export default function CenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TenantWatcher />
      <Sidebar items={navItems} title="Centre Manager" />
      <ContentShell>
        <Header title="Centre Panel" />
        <main className="p-4 lg:p-6 !pt-20">{children}</main>
      </ContentShell>
    </div>
  )
}
