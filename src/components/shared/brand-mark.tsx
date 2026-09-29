/**
 * The EduQuest mark: a ring (the Q of Quest) holding an E drawn as rising
 * steps, with a gold star breaking out of the ring at the top.
 *
 * Brand colours are fixed (not theme tokens) — the tile is its own
 * background, so the mark reads the same on light and dark pages. The part
 * classes (eq-bm-*) are the hooks for the sign-in intro and the hover
 * animation in globals.css; they do nothing on their own.
 */
export function BrandMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`eq-brand-mark shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="eq-bm-tile" width="64" height="64" rx="16" fill="#2563eb" />
      <g transform="translate(31 33)">
        <circle className="eq-bm-ring" r="20" fill="none" stroke="#fff" strokeOpacity=".92" strokeWidth="4.5" strokeLinecap="round" transform="rotate(-90)" />
        <rect className="eq-bm-spine" x="-12" y="-11" width="4.5" height="21" rx="2.25" fill="#fff" />
        <rect className="eq-bm-step eq-bm-step1" x="-12" y="5.5" width="11" height="4.5" rx="2.25" fill="#fff" fillOpacity=".6" />
        <rect className="eq-bm-step eq-bm-step2" x="-12" y="-2.75" width="16" height="4.5" rx="2.25" fill="#fff" fillOpacity=".82" />
        <rect className="eq-bm-step eq-bm-step3" x="-12" y="-11" width="21" height="4.5" rx="2.25" fill="#fff" />
        <path className="eq-bm-star" d="M16 -24 L17.9 -18.9 L23 -17 L17.9 -15.1 L16 -10 L14.1 -15.1 L9 -17 L14.1 -18.9 Z" fill="#fbbf24" />
      </g>
    </svg>
  )
}
