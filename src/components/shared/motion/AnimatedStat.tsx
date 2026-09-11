'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

function useCountUp(target: string, active: boolean) {
  const [display, setDisplay] = useState(active ? target : '0')
  useEffect(() => {
    if (!active) return
    const num = parseInt(target.replace(/\D/g, ''), 10)
    if (isNaN(num)) { queueMicrotask(() => setDisplay(target)); return }
    let start = 0
    const step = Math.max(1, Math.ceil(num / 40))
    const id = setInterval(() => {
      start = Math.min(start + step, num)
      setDisplay(target.replace(/\d+/, String(start)))
      if (start >= num) clearInterval(id)
    }, 30)
    return () => clearInterval(id)
  }, [active, target])
  return display
}

type Props = {
  icon?: LucideIcon
  label: string
  value: string
  sub?: string
  accent?: string
  className?: string
}

export function AnimatedStat({ icon: Icon, label, value, sub, accent, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduced = useReducedMotion()
  const display = useCountUp(value, reduced ? true : inView)

  return (
    <motion.div
      ref={ref}
      className={`eq-card-hover bg-elevated border border-border rounded-[20px] p-5 sm:p-6 ${className ?? ''}`}
      initial={reduced ? undefined : { opacity: 0, y: 16 }}
      animate={inView || reduced ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
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
      <p className="text-2xl font-black text-fg" style={{ letterSpacing: '-0.02em' }}>{display}</p>
      {sub && <p className="text-fg-muted text-xs mt-1">{sub}</p>}
    </motion.div>
  )
}
