'use client'

import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

// Wraps dashboard page content: no sidebar offset on mobile (drawer overlays),
// offset matching the collapsible sidebar width on desktop.
export function ContentShell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen } = useUIStore()
  return (
    <div className={cn('transition-all duration-300', sidebarOpen ? 'lg:ps-64' : 'lg:ps-16')}>
      {children}
    </div>
  )
}
