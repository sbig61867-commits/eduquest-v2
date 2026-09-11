import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-16 px-6', className)}>
      <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center mb-4">
        <Icon className="w-5 h-5 text-fg-muted" aria-hidden="true" />
      </div>
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {description && (
        <p className="text-[13px] text-fg-muted mt-1.5 max-w-xs leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
