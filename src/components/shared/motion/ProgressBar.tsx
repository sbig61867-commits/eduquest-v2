'use client'

import { useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'

type Props = {
  value: number
  max?: number
  label?: string
  accent?: string
  className?: string
  showPercent?: boolean
}

export function ProgressBar({ value, max = 100, label, accent, className, showPercent = true }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduced = useReducedMotion()
  const pct = Math.max(0, Math.min(100, (value / max) * 100))

  return (
    <div ref={ref} className={className}>
      {(label || showPercent) && (
        <div className="flex items-center justify-between mb-1.5 text-xs">
          {label && <span className="text-fg-secondary font-medium">{label}</span>}
          {showPercent && <span className="text-fg-muted tabular-nums">{Math.round(pct)}%</span>}
        </div>
      )}
      <div className="h-2 rounded-full bg-surface overflow-hidden">
        <motion.div
          className="eq-progress-fill h-full rounded-full"
          style={{ backgroundColor: accent ?? 'var(--color-accent)' }}
          initial={{ width: reduced ? `${pct}%` : 0 }}
          animate={{ width: (inView || reduced) ? `${pct}%` : 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  )
}
