'use client'

import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

// Offsets page content to the inline-start side of the fixed sidebar.
// Uses logical property ps- (padding-inline-start) so RTL is handled correctly.
export function ContentShell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen } = useUIStore()
  return (
    <div className={cn(
      'transition-[padding-inline-start] duration-200',
      sidebarOpen ? 'lg:ps-64' : 'lg:ps-16'
    )}>
      {children}
    </div>
  )
}
