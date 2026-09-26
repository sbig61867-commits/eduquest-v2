/**
 * Light / dark appearance for the public surface (marketing pages + sign-in).
 *
 * The dark look is the art-directed original. Light is produced in CSS by
 * remapping the palette inside `.eq-public` (see src/app/globals.css), so the
 * components keep one set of classes.
 *
 * Resolution: the `eq_theme` cookie, when present, is copied onto
 * <html data-eq-theme> by THEME_BOOT_SCRIPT, an inline script in the root
 * layout's <head> that runs before first paint (no flash). It is read in the
 * browser, never on the server, so a public page's HTML does not depend on the
 * visitor's cookies and can be served from the CDN cache (see src/proxy.ts).
 * Without the cookie the page follows `prefers-color-scheme`.
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

/** Runs before first paint: applies a saved choice to <html>. Keep it tiny and dependency-free. */
export const THEME_BOOT_SCRIPT =
  `try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)/);` +
  `if(m)document.documentElement.setAttribute('${THEME_ATTR}',m[1])}catch(e){}`
