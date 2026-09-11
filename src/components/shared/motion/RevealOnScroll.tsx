import type { ReactNode } from 'react'

export function RevealOnScroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>
}
