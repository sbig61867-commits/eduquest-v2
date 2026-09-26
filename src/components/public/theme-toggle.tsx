'use client'

import { useTranslations } from 'next-intl'
import { applyTheme, effectiveTheme } from '@/lib/theme'

// Switches the public surface between its light and dark appearance.
//
// It holds no React state: what it shows is decided in CSS by the `eq-light`
// variant (src/app/globals.css), so the server render is already right for a
// cookie choice and for the system setting alike. No icon font by design:
// the sun and the moon are drawn with CSS.
export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useTranslations('common.theme')
  return (
    <button
      type="button"
      onClick={() => applyTheme(effectiveTheme() === 'light' ? 'dark' : 'light')}
      aria-label={t('toggle')}
      title={t('toggle')}
      className={`relative flex items-center justify-center w-9 h-8 rounded-full border border-slate-700 bg-slate-900/70 hover:border-slate-500 transition-colors ${className}`}
    >
      {/* Moon (dark appearance) */}
      <span aria-hidden="true" className="block w-3.5 h-3.5 rounded-full shadow-[inset_-4px_-2px_0_0_var(--color-slate-200)] -rotate-12 eq-light:hidden" />
      {/* Sun (light appearance) */}
      <span aria-hidden="true" className="hidden eq-light:block w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-amber-400)_30%,transparent)]" />
    </button>
  )
}
