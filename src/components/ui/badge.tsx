import { cn } from '@/lib/utils'

// Variants are named by meaning, not color.
// The same semantic state always maps to the same visual treatment regardless
// of context — "Active", "Published", and "Passed" all use 'success'.
interface BadgeProps {
  children: React.ReactNode
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral'
  className?: string
}

export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  const variants = {
    success: 'bg-success-subtle text-success border-success/20',
    warning: 'bg-warning-subtle text-warning border-warning/20',
    error:   'bg-error-subtle   text-error   border-error/20',
    info:    'bg-info-subtle    text-info     border-info/20',
    neutral: 'bg-surface        text-fg-secondary border-border',
  }
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}
