'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { getRoleLabel } from '@/lib/utils'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const { user } = useAuthStore()
  const { sidebarOpen } = useUIStore()

  return (
    <header className={cn(
      'fixed top-0 right-0 h-16 bg-slate-950/80 backdrop-blur border-b border-slate-800 flex items-center justify-between px-6 z-30 transition-all duration-300',
      sidebarOpen ? 'left-64' : 'left-16'
    )}>
      <h1 className="text-white font-semibold text-lg">{title}</h1>

      <div className="flex items-center gap-4">
        <button className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
          <Bell className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">
              {user?.full_name?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="hidden sm:block">
            <p className="text-white text-sm font-medium leading-none">{user?.full_name ?? 'User'}</p>
            <p className="text-slate-400 text-xs mt-0.5">{user?.role ? getRoleLabel(user.role) : ''}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
