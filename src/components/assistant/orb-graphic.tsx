'use client'

// The study assistant's orb: two soft wavy layers that slowly change shape,
// rings that ripple outward like waves, and a wave line across the solid core.
// Flat token colours only (design contract: no gradients, no blur). Motion is
// SVG <animate>, so nothing is added to globals.css; with reduced motion the
// orb is drawn still.

const CENTER = 50

/** A smooth closed blob through `radii.length` points (Catmull-Rom → cubic Bézier).
 *  Every variant has the same number of points, so <animate> can morph between them. */
export function blobPath(radii: number[], cx: number = CENTER, cy: number = CENTER): string {
  const n = radii.length
  const pts = radii.map((r, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
  const p = (i: number) => pts[(i + n) % n]
  const f = (v: number) => v.toFixed(2)
  let d = `M${f(p(0)[0])} ${f(p(0)[1])}`
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + ' Z'
}

const OUTER = [
  [40, 37, 41, 36, 40, 38, 41, 36],
  [37, 41, 36, 40, 37, 41, 36, 40],
  [41, 36, 39, 41, 36, 39, 37, 41],
].map(r => blobPath(r))
const INNER = [
  [33, 31, 34, 30, 33, 31, 34, 30],
  [30, 34, 31, 33, 30, 34, 31, 33],
  [34, 30, 32, 34, 31, 32, 30, 34],
].map(r => blobPath(r))
const WAVE = [
  'M29 51 Q35 44 41 51 T53 51 T65 51 T71 51',
  'M29 51 Q35 58 41 51 T53 51 T65 51 T71 51',
]

const loop = (frames: string[]) => [...frames, frames[0]].join(';')

export function OrbGraphic({ animated }: { animated: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" aria-hidden="true" focusable="false">
      {[0, 1.6].map(begin => (
        <circle key={begin} cx={CENTER} cy={CENTER} r="30" className="fill-none stroke-accent" strokeWidth="1.5" opacity={animated ? 0 : 0.35}>
          {animated && (
            <>
              <animate attributeName="r" values="30;49" dur="3.2s" begin={`${begin}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0" dur="3.2s" begin={`${begin}s`} repeatCount="indefinite" />
            </>
          )}
        </circle>
      ))}
      <path d={OUTER[0]} className="fill-accent/20">
        {animated && <animate attributeName="d" values={loop(OUTER)} dur="9s" repeatCount="indefinite" />}
      </path>
      <path d={INNER[0]} className="fill-accent/40">
        {animated && <animate attributeName="d" values={loop(INNER)} dur="6.5s" repeatCount="indefinite" />}
      </path>
      <circle cx={CENTER} cy={CENTER} r="24" className="fill-accent" />
      <path d={WAVE[0]} className="fill-none stroke-accent-fg" strokeWidth="3.5" strokeLinecap="round">
        {animated && <animate attributeName="d" values={loop(WAVE)} dur="2.4s" repeatCount="indefinite" />}
      </path>
    </svg>
  )
}
