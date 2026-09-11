'use client'

import { useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'

type Props = {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  accent?: string
  label?: string
  className?: string
}

export function ProgressRing({ value, max = 100, size = 88, strokeWidth = 8, accent, label, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduced = useReducedMotion()
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  return (
    <div ref={ref} className={`relative inline-flex items-center justify-center ${className ?? ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-surface)" strokeWidth={strokeWidth} />
        <motion.circle
          className="eq-progress-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={accent ?? 'var(--color-accent)'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: reduced ? offset : circumference }}
          animate={{ strokeDashoffset: (inView || reduced) ? offset : circumference }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-fg font-bold text-sm tabular-nums">{Math.round(pct)}%</span>
        {label && <span className="text-fg-muted text-[10px] mt-0.5">{label}</span>}
      </div>
    </div>
  )
}
