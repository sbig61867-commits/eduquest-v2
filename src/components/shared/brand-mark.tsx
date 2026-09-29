'use client'

import { useId } from 'react'

/**
 * The EduQuest mark: a solid (extruded) E, head raised, wearing a black
 * leather mortarboard whose gold tassel hangs over the brim. On a deep blue
 * gradient tile with a soft sheen.
 *
 * Still everywhere. It moves only inside the sign-in intro (brand-intro.tsx:
 * particles gather into the E, the cap drops, the E lifts its head, the tassel
 * swings) — owner's rule. The part classes (eq-bm-*) are the intro's hooks in
 * globals.css; `children` render inside the tilted head (the intro's
 * particles). Brand colours are fixed, not theme tokens: the tile is its own
 * background. Gradient ids come from useId — several marks share a page.
 */

const E_PATH = 'M18 25 H43 V32 H26 V36.5 H38 V43 H26 V48 H43 V55 H18 Z'

/** Tassel: cord from the cap button over the brim at (46,15), hanging L. */
export const TASSEL_REST = 0.17 // radians — hangs plumb once the head is tilted 10°
const BRIM = [46, 15] as const
const CORD = 11
export const FRINGE_COUNT = 7

export function tasselGeometry(theta: number, omega = 0) {
  const ex = BRIM[0] + CORD * Math.sin(theta)
  const ey = BRIM[1] + CORD * Math.cos(theta)
  const cx = BRIM[0] + CORD * 0.5 * Math.sin(theta * 0.35)
  const cy = BRIM[1] + CORD * 0.5 * Math.cos(theta * 0.35)
  const lag = theta - omega * 0.05 // strands trail the knot while it swings
  const fringe = Array.from({ length: FRINGE_COUNT }, (_, i) => {
    const a = lag + (i - 3) * 0.09
    const len = 6.5 - Math.abs(i - 3) * 0.3
    return { x1: ex, y1: ey + 1, x2: ex + len * Math.sin(a), y2: ey + 1 + len * Math.cos(a) }
  })
  return {
    cord: `M29 15 L${BRIM[0] - 1} 15 Q${BRIM[0]} 15 ${BRIM[0]} 16 Q${cx} ${cy} ${ex} ${ey}`,
    knot: { cx: ex, cy: ey + 0.6 },
    fringe,
  }
}

const f = (n: number) => Math.round(n * 100) / 100

export function BrandMark({ size = 36, className = '', children }: {
  size?: number; className?: string; children?: React.ReactNode
}) {
  const id = useId().replace(/:/g, '')
  const g = (name: string) => `eq-${name}-${id}`
  const rest = tasselGeometry(TASSEL_REST)
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`eq-brand-mark shrink-0 ${className}`}
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={g('tile')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset=".32" stopColor="#2563eb" />
          <stop offset=".72" stopColor="#1e3a8a" />
          <stop offset="1" stopColor="#172554" />
        </linearGradient>
        <radialGradient id={g('sheen')} cx=".22" cy=".12" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g('face')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#dbeafe" />
        </linearGradient>
        <linearGradient id={g('leather')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a4a4f" />
          <stop offset=".45" stopColor="#1c1c1f" />
          <stop offset="1" stopColor="#050506" />
        </linearGradient>
        <linearGradient id={g('band')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2a2e" />
          <stop offset="1" stopColor="#0a0a0b" />
        </linearGradient>
        <linearGradient id={g('gold')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f59e0b" />
          <stop offset=".5" stopColor="#fde68a" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>

      <g className="eq-bm-tile">
        <rect width="64" height="64" rx="16" fill={`url(#${g('tile')})`} />
        <rect width="64" height="64" rx="16" fill={`url(#${g('sheen')})`} />
        <rect x=".6" y=".6" width="62.8" height="62.8" rx="15.4" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1.2" />
      </g>

      <g className="eq-bm-head" transform="rotate(-10 18 55)">
        <path className="eq-bm-depth" d={E_PATH} fill="#0f1d4a" fillOpacity=".85" transform="translate(2.4 2.4)" />
        <path className="eq-bm-face" d={E_PATH} fill={`url(#${g('face')})`} />
        {children}

        <g className="eq-bm-cap">
          <path d="M21 18.5 V23 Q29 26.5 37 23 V18.5 L29 22 Z" fill={`url(#${g('band')})`} stroke="#000" strokeWidth=".4" />
          <path d="M12 15 L29 8 L46 15 L29 22 Z" fill={`url(#${g('leather')})`} stroke="#000" strokeWidth=".5" />
          <path d="M16.5 15 L29 10 L41.5 15 L29 20 Z" fill="none" stroke="#6b6b70" strokeWidth=".5" strokeDasharray="1 1" />
          <path d="M15 14.6 L29 9 L33 10.6" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth=".8" strokeLinecap="round" />
          <g className="eq-bm-tassel">
            <path className="eq-bm-cord" d={rest.cord} fill="none" stroke={`url(#${g('gold')})`} strokeWidth="1.3" strokeLinecap="round" />
            {rest.fringe.map((l, i) => (
              <line key={i} className="eq-bm-fringe" x1={f(l.x1)} y1={f(l.y1)} x2={f(l.x2)} y2={f(l.y2)}
                stroke={i % 2 ? '#fde68a' : '#f59e0b'} strokeWidth=".75" strokeLinecap="round" />
            ))}
            <ellipse className="eq-bm-knot" cx={f(rest.knot.cx)} cy={f(rest.knot.cy)} rx="1.4" ry="1.1" fill="#f59e0b" />
            <circle cx="29" cy="15" r="1.7" fill={`url(#${g('gold')})`} />
          </g>
        </g>
      </g>
    </svg>
  )
}
