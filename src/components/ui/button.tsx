'use client'

import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    const base = [
      'inline-flex items-center justify-center font-medium rounded-md transition-colors',
      'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed',
    ].join(' ')

    const variants = {
      primary:   'bg-accent text-accent-fg hover:bg-accent-hover',
      secondary: 'bg-elevated text-fg border border-border hover:bg-surface hover:border-border-strong',
      danger:    'bg-error text-accent-fg hover:opacity-90',
      ghost:     'text-fg-secondary hover:text-fg hover:bg-canvas',
    }

    const sizes = {
      sm: 'px-3 py-1.5 text-sm gap-1.5',
      md: 'px-4 py-2 text-sm gap-2',
      lg: 'px-5 py-2.5 text-base gap-2',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && (
          <span
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
