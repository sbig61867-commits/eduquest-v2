/**
 * The Tilmoo mark: a navy tile with a gold "T" whose crossbar opens into an
 * open book, and a single gold spark above it (learning, and a student's
 * first idea). Flat colours, no gradients, so it reads the same at 24 px on a
 * phone and on the print report. Colours are fixed brand values, not theme
 * tokens: the tile is its own background in both themes.
 *
 * The mark is still. The sign-in welcome no longer animates a logo (owner,
 * 2026-10-10), so there is no motion here.
 */
export function BrandMark({ size = 36, className = '', children }: {
  size?: number; className?: string; children?: React.ReactNode
}) {
  return (
    <svg
      role="img"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="#13224a" />
      {/* The T: a bar across the top, a stem down the middle. */}
      <path d="M16 19 H48 V27 H36.5 V46 H27.5 V27 H16 Z" fill="#d4af5f" />
      {/* The open book under the T: two pages meeting at the spine. */}
      <path d="M12 47 Q22 42 32 47 Q42 42 52 47 V53 Q42 48 32 53 Q22 48 12 53 Z" fill="#e3c788" />
      {/* A single spark: the first idea. */}
      <circle cx="50" cy="13" r="3.2" fill="#f1e2b8" />
      {children}
    </svg>
  )
}
