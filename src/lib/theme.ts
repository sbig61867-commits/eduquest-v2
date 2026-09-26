/**
 * Light / dark appearance for the public surface (marketing pages + sign-in).
 *
 * The dark look is the art-directed original. Light is produced in CSS by
 * remapping the palette inside `.eq-public` (see src/app/globals.css), so the
 * components keep one set of classes.
 *
 * Resolution: the `eq_theme` cookie, when present, is written onto
 * <html data-eq-theme> by the root layout on the server (no flash, no inline
 * script). Without it the page follows `prefers-color-scheme`.
 */
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export const THEME_COOKIE = 'eq_theme'
export const THEME_ATTR = 'data-eq-theme'
const MAX_AGE = 60 * 60 * 24 * 365

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/** The theme currently on screen: explicit choice, else the system setting. */
export function effectiveTheme(): Theme {
  const explicit = document.documentElement.getAttribute(THEME_ATTR)
  if (isTheme(explicit)) return explicit
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Applies the theme immediately and remembers it for the next request. */
export function applyTheme(next: Theme) {
  document.documentElement.setAttribute(THEME_ATTR, next)
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${MAX_AGE}; samesite=lax`
}
