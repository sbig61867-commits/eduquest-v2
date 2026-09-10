'use client'

import type { LucideIcon } from 'lucide-react'

type Props = {
  icon?: LucideIcon
  label: string
  value: string
  sub?: string
  accent?: string
  className?: string
}

/**
 * Dashboard-safe stat card.
 *
 * This component intentionally has no animation/runtime dependency. Dashboard
 * pages are a critical path, so rendering their core metrics must not depend on
 * Framer Motion or browser viewport observers.
 */
export function AnimatedStat({ icon: Icon, label, value, sub, accent, className }: Props) {
  return (
    <div
      className={`eq-card-hover bg-elevated border border-border rounded-[20px] p-5 sm:p-6 ${className ?? ''}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-fg-muted text-xs font-semibold">{label}</span>
        {Icon && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: accent ? `${accent}20` : 'var(--color-accent-subtle)' }}
          >
            <Icon className="w-4 h-4" style={{ color: accent ?? 'var(--color-accent)' }} />
          </div>
        )}
      </div>
      <p className="text-2xl font-black text-fg" style={{ letterSpacing: '-0.02em' }}>{value}</p>
      {sub && <p className="text-fg-muted text-xs mt-1">{sub}</p>}
    </div>
  )
}
