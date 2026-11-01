'use client'

import { useTranslations } from 'next-intl'
import { applyTheme, effectiveTheme } from '@/lib/theme'

// One appearance button whose icon morphs sun <-> crescent, used on the public
// surface AND in the signed-in header.
//
// No React state: the icon shape is decided in CSS by the page theme attribute
// (.eq-theme-icon rules in src/app/globals.css), so the first paint is already
// right for a cookie choice and for the system setting alike. The page
// attribute flips at once so the morph plays, then applyTheme stores the
// choice and reloads. The label names the mode the button switches to.
export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useTranslations('common.theme')
  const toggle = () => {
    const next = effectiveTheme() === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-eq-theme', next)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.setTimeout(() => applyTheme(next), reduce ? 0 : 450)
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title={t('toggle')}
      className={`eq-focus inline-flex items-center justify-center w-9 h-9 rounded-full border border-line bg-surface text-fg-2 shadow-sm hover:text-fg hover:border-line-strong hover:bg-elevated transition-colors ${className}`}
    >
      {/* Both labels exist; CSS shows the one for the mode the click leads to. */}
      <span className="sr-only eq-light:hidden">{t('light')}</span>
      <span className="sr-only hidden eq-light:inline">{t('dark')}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="eq-theme-icon w-[18px] h-[18px]" fill="none">
        <defs>
          <mask id="eq-theme-cut">
            <rect width="24" height="24" fill="white" />
            <circle className="eq-ti-cut" cx="17" cy="7" r="5" fill="black" />
          </mask>
        </defs>
        <circle className="eq-ti-disc" cx="12" cy="12" r="4.5" fill="currentColor" mask="url(#eq-theme-cut)" />
        <g className="eq-ti-rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </g>
      </svg>
    </button>
  )
}
