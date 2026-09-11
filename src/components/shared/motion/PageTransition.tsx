import type { ReactNode } from 'react'

export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>
}
