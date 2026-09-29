'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The short form of a long institution name: the part before a bracketed
 * qualifier ("مركز التعليم المستمر (جامعة القدس المفتوحة)" → "مركز التعليم
 * المستمر"), then cut at `max` characters on a word boundary.
 */
export function shortName(name: string, max = 28): string {
  const base = name.split(/[(（]/)[0].trim() || name.trim()
  if (base.length <= max) return base
  const cut = base.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trim()}…`
}

/**
 * Shows the short name; hovering (or focusing) drops the full name down
 * beneath it. The popover is position:fixed so a parent with
 * overflow:hidden (the sidebar) cannot clip it.
 */
export function AdaptiveName({ name, max, className }: { name: string; max?: number; className?: string }) {
  const short = shortName(name, max)
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; right: number } | null>(null)
  const truncated = short !== name.trim()

  const open = () => {
    if (!truncated || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right })
  }

  return (
    <span
      ref={ref}
      tabIndex={truncated ? 0 : undefined}
      aria-label={name}
      onMouseEnter={open}
      onMouseLeave={() => setPos(null)}
      onFocus={open}
      onBlur={() => setPos(null)}
      className={cn('inline-block max-w-full truncate align-bottom', truncated && 'cursor-help', className)}
    >
      {short}
      {pos && (
        <span
          role="tooltip"
          style={document.documentElement.dir === 'rtl' ? { top: pos.top, right: pos.right } : { top: pos.top, left: pos.left }}
          className="fixed z-50 max-w-xs whitespace-normal rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-normal text-slate-200 shadow-xl"
        >
          {name}
        </span>
      )}
    </span>
  )
}
