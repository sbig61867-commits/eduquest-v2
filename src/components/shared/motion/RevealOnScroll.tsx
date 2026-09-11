'use client'

import { motion, useReducedMotion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
  once?: boolean
  /** 'view' (default) animates in when scrolled into view; 'mount' animates in immediately — use for above-the-fold, single-screen content like auth cards where scroll-triggering can't be relied on to fire. */
  mode?: 'view' | 'mount'
}

export function RevealOnScroll({ children, className, delay = 0, y = 16, once = true, mode = 'view' }: Props) {
  const reduced = useReducedMotion()

  const variants: Variants = reduced
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y },
        visible: { opacity: 1, y: 0 },
      }

  const transition = { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const }

  if (mode === 'mount') {
    return (
      <motion.div
        className={className}
        initial="hidden"
        animate="visible"
        variants={variants}
        transition={transition}
      >
        {children}
      </motion.div>
    )
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount: 0.2 }}
      variants={variants}
      transition={transition}
    >
      {children}
    </motion.div>
  )
}
