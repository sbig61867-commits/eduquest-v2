/**
 * Light / dark appearance — one system for the whole product: the public
 * surface (marketing pages + sign-in) AND the signed-in app.
 *
 * Resolution: the `eq_theme` cookie, else `prefers-color-scheme`. Either way
 * THEME_BOOT_SCRIPT (inline in the root layout's <head>, runs before first
 * paint) writes the result onto <html data-eq-theme>, so CSS only ever reads
 * the attribute. It runs in the browser, never on the server, so a public
 * page's HTML does not depend on the visitor's cookies and stays CDN-cacheable
 * (see src/proxy.ts).
 *
 * Colours: the `--eq-*` tokens (src/app/design-tokens.css) and the slate
 * remap for components still on raw palette classes (src/app/globals.css).
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

/**
 * Remembers the choice and reloads the page (owner's rule 2026-10-09: a theme
 * or language switch is always a full reload, so every surface — canvases,
 * charts, cached inline styles — is redrawn in the new appearance).
 */
export function applyTheme(next: Theme) {
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${MAX_AGE}; samesite=lax`
  document.documentElement.setAttribute(THEME_ATTR, next)
  window.location.reload()
}

/** Runs before first paint: resolves the theme onto <html>. Keep it tiny and dependency-free. */
export const THEME_BOOT_SCRIPT =
  `try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)/);` +
  `document.documentElement.setAttribute('${THEME_ATTR}',m?m[1]:` +
  `(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'))}catch(e){}`
