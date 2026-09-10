'use client'

import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  staggerDelay?: number
  once?: boolean
}

/**
 * Layout-safe replacement for the animated stagger container.
 *
 * Dashboard content should render deterministically even if an animation
 * library fails to initialize in the production bundle. The props are kept
 * for API compatibility so callers do not need to change.
 */
export function StaggerGrid({ children, className }: Props) {
  return <div className={className}>{children}</div>
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>
}
