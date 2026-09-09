'use client'

import { motion, useReducedMotion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  staggerDelay?: number
  once?: boolean
}

export function StaggerGrid({ children, className, staggerDelay = 0.06, once = true }: Props) {
  const reduced = useReducedMotion()

  const container: Variants = reduced
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : {
        hidden: {},
        visible: { transition: { staggerChildren: staggerDelay } },
      }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount: 0.15 }}
      variants={container}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()

  const item: Variants = reduced
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 16 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
      }

  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  )
}
